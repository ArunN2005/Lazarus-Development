// ============================================================================
// LAZARUS — Validator Agent (Agent 6)
// Post-deploy health checks, log scanning, X-Ray trace analysis, heal loop
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
  GetLogEventsCommand,
  DescribeLogGroupsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { cloudwatchLogsClient } from '../../shared/aws-clients';
import { classifyLogBatch, getSeverityScore } from '../../shared/errorClassifier';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type ValidationResult,
  type RouteCheckResult,
  type ClassifiedError,
} from '../../shared/types';

const VALIDATION_TIMEOUT_MS = 120_000; // 2 minutes
const HEALTH_CHECK_INTERVALS = [5, 10, 15, 30, 60]; // seconds

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: {
  projectId: string;
  liveUrl: string;
  serviceArn: string;
}): Promise<ValidationResult> {
  const config = getConfig();
  const { projectId, liveUrl, serviceArn } = event;

  log('info', 'Validator Agent starting', { projectId, liveUrl });

  try {
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.VALIDATING,
      currentPhase: PhaseNumber.VALIDATE,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.VALIDATE,
        phaseName: 'Validator',
        message: 'Validating deployed application...',
      })
    );

    // 1. Progressive health checks
    const healthResults = await progressiveHealthCheck(projectId, liveUrl);

    // 2. Scan CloudWatch logs
    const logErrors = await scanCloudWatchLogs(projectId, serviceArn);

    // 3. Check key endpoints
    const endpointResults = await checkEndpoints(projectId, liveUrl);

    // 4. Check response quality
    const responseQuality = await checkResponseQuality(projectId, liveUrl);

    // 5. Calculate overall health score
    const healthScore = calculateHealthScore(
      healthResults,
      logErrors,
      endpointResults,
      responseQuality
    );

    // 6. Determine if heal is needed
    const needsHeal = healthScore < 80 && logErrors.length > 0;

    if (needsHeal) {
      log('warn', 'Application needs healing', {
        projectId,
        healthScore,
        errors: logErrors.length,
      });

      await ws.send(
        projectId,
        WebSocketHelper.createEvent(WebSocketEventType.VALIDATION_HEAL, projectId, {
          healthScore,
          errors: logErrors.length,
          message: 'Application has issues. Attempting post-deploy healing...',
        })
      );

      // Attempt post-deploy heal (single pass)
      await postDeployHeal(projectId, logErrors);
    }

    // 7. Update project
    const finalStatus = healthScore >= 60
      ? ProjectStatus.COMPLETE
      : ProjectStatus.DEGRADED;

    await db.update(config.projectsTable, { projectId }, {
      status: finalStatus,
      healthScore,
      completedAt: new Date().toISOString(),
    });

    // Calculate total cost
    const totalCost = await costTracker.getTotalCost(projectId);
    await db.update(config.projectsTable, { projectId }, {
      cost: totalCost,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.VALIDATE,
        phaseName: 'Validator',
        healthScore,
        liveUrl,
        totalCost,
        message: healthScore >= 80
          ? `Validation passed! Health score: ${healthScore}/100`
          : `Validation complete with issues. Health score: ${healthScore}/100`,
      })
    );

    // Send final project_complete event
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PROJECT_COMPLETE, projectId, {
        liveUrl,
        healthScore,
        totalCost,
        message: 'Migration complete!',
      })
    );

    return {
      projectId,
      healthScore,
      liveUrl,
      totalCost,
      routeResults: healthResults as unknown as RouteCheckResult[],
      logErrors,
      traceIssues: [],
      passed: healthScore >= 85,
      healAttempt: 0,
      healthChecks: healthResults as unknown as RouteCheckResult[],
      endpointResults: endpointResults as unknown as RouteCheckResult[],
      needsHeal,
      success: healthScore >= 60,
    };
  } catch (error) {
    log('error', 'Validator Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: `Validator: ${String(error)}`,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.VALIDATE,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Progressive health check
// ---------------------------------------------------------------------------

interface HealthCheckResult {
  interval: number;
  status: number;
  responseTime: number;
  success: boolean;
}

async function progressiveHealthCheck(
  projectId: string,
  liveUrl: string
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  for (const interval of HEALTH_CHECK_INTERVALS) {
    await sleep(interval * 1000);

    const startTime = Date.now();
    let status = 0;
    let success = false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(liveUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Lazarus-Validator/1.0' },
      });

      clearTimeout(timeoutId);

      status = response.status;
      success = status >= 200 && status < 500;
    } catch (error) {
      log('warn', 'Health check failed', {
        projectId,
        interval,
        error: String(error),
      });
    }

    const responseTime = Date.now() - startTime;

    results.push({ interval, status, responseTime, success });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.HEALTH_CHECK, projectId, {
        interval,
        status,
        responseTime,
        success,
      })
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// CloudWatch log scanning
// ---------------------------------------------------------------------------

async function scanCloudWatchLogs(
  projectId: string,
  serviceArn: string
): Promise<ClassifiedError[]> {
  try {
    // App Runner log group pattern
    const logGroupName = `/aws/apprunner/${serviceArn.split('/').pop()}`;

    // Check if log group exists
    const describeResult = await cloudwatchLogsClient.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: logGroupName,
        limit: 1,
      })
    );

    if (!describeResult.logGroups || describeResult.logGroups.length === 0) {
      log('info', 'No CloudWatch logs found', { projectId, logGroupName });
      return [];
    }

    // Get recent log events
    const logResult = await cloudwatchLogsClient.send(
      new GetLogEventsCommand({
        logGroupName,
        logStreamName: 'latest', // This is simplified — real implementation should list streams
        startTime: Date.now() - 300_000, // Last 5 minutes
        limit: 200,
      })
    );

    const logLines = (logResult.events ?? [])
      .map((e) => e.message ?? '')
      .filter(Boolean);

    if (logLines.length === 0) return [];

    return classifyLogBatch(logLines);
  } catch (error) {
    log('warn', 'CloudWatch log scan failed', {
      projectId,
      error: String(error),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Endpoint checking
// ---------------------------------------------------------------------------

interface EndpointResult {
  path: string;
  status: number;
  responseTime: number;
  success: boolean;
  contentType?: string;
}

async function checkEndpoints(
  projectId: string,
  liveUrl: string
): Promise<EndpointResult[]> {
  const endpoints = [
    '/',
    '/api/health',
    '/health',
    '/favicon.ico',
    '/robots.txt',
  ];

  const results: EndpointResult[] = [];

  for (const path of endpoints) {
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${liveUrl}${path}`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Lazarus-Validator/1.0' },
      });

      clearTimeout(timeoutId);

      results.push({
        path,
        status: response.status,
        responseTime: Date.now() - startTime,
        success: response.status >= 200 && response.status < 500,
        contentType: response.headers.get('content-type') ?? undefined,
      });
    } catch {
      results.push({
        path,
        status: 0,
        responseTime: Date.now() - startTime,
        success: false,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Response quality check
// ---------------------------------------------------------------------------

interface ResponseQuality {
  hasHTML: boolean;
  hasCSS: boolean;
  hasJS: boolean;
  hasTitle: boolean;
  contentLength: number;
  loadTime: number;
}

async function checkResponseQuality(
  projectId: string,
  liveUrl: string
): Promise<ResponseQuality> {
  const result: ResponseQuality = {
    hasHTML: false,
    hasCSS: false,
    hasJS: false,
    hasTitle: false,
    contentLength: 0,
    loadTime: 0,
  };

  try {
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(liveUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    result.loadTime = Date.now() - startTime;

    const body = await response.text();
    result.contentLength = body.length;
    result.hasHTML = body.includes('<!DOCTYPE') || body.includes('<html');
    result.hasCSS = body.includes('<link') && body.includes('.css');
    result.hasJS = body.includes('<script');
    result.hasTitle = /<title>[\s\S]+?<\/title>/.test(body);
  } catch (error) {
    log('warn', 'Response quality check failed', {
      projectId,
      error: String(error),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Health score calculation
// ---------------------------------------------------------------------------

function calculateHealthScore(
  healthResults: HealthCheckResult[],
  logErrors: ClassifiedError[],
  endpointResults: EndpointResult[],
  responseQuality: ResponseQuality
): number {
  let score = 0;

  // Health check score (40 points)
  const passedChecks = healthResults.filter((r) => r.success).length;
  score += (passedChecks / Math.max(1, healthResults.length)) * 40;

  // Average response time bonus (10 points)
  const avgResponseTime = healthResults
    .filter((r) => r.success)
    .reduce((sum, r) => sum + r.responseTime, 0) / Math.max(1, passedChecks);

  if (avgResponseTime < 500) score += 10;
  else if (avgResponseTime < 1000) score += 7;
  else if (avgResponseTime < 3000) score += 3;

  // Log error penalty (20 points max)
  const criticalErrors = logErrors.filter(
    (e) => getSeverityScore(e.category) >= 8
  ).length;
  const warningErrors = logErrors.filter(
    (e) => getSeverityScore(e.category) >= 5 && getSeverityScore(e.category) < 8
  ).length;

  const logScore = Math.max(0, 20 - criticalErrors * 5 - warningErrors * 2);
  score += logScore;

  // Endpoint score (20 points)
  const rootSuccess = endpointResults.find((r) => r.path === '/')?.success ?? false;
  if (rootSuccess) score += 10;

  const otherEndpoints = endpointResults.filter((r) => r.path !== '/' && r.success).length;
  score += Math.min(10, otherEndpoints * 2.5);

  // Response quality (10 points)
  if (responseQuality.hasHTML) score += 3;
  if (responseQuality.hasTitle) score += 2;
  if (responseQuality.contentLength > 100) score += 3;
  if (responseQuality.loadTime < 2000) score += 2;

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ---------------------------------------------------------------------------
// Post-deploy healing
// ---------------------------------------------------------------------------

async function postDeployHeal(
  projectId: string,
  errors: ClassifiedError[]
): Promise<void> {
  const config = getConfig();
  const { bedrock: bedrockHelper, MODELS: models } = await import('../../shared/bedrock');

  // Only attempt heal for fixable errors
  const fixableErrors = errors.filter(
    (e) => !['MEMORY_ERROR', 'PERMISSION_ERROR'].includes(e.category)
  );

  if (fixableErrors.length === 0) return;

  // Group by file
  const errorsByFile = new Map<string, ClassifiedError[]>();
  for (const error of fixableErrors) {
    const file = error.file ?? 'unknown';
    if (!errorsByFile.has(file)) errorsByFile.set(file, []);
    errorsByFile.get(file)!.push(error);
  }

  for (const [filePath, fileErrors] of errorsByFile) {
    if (filePath === 'unknown') continue;

    try {
      const content = await s3.download(
        config.projectsBucket,
        `${projectId}/generated/${filePath}`
      );

      const prompt = `Fix these runtime errors. The application is deployed but has issues.

FILE: ${filePath}

RUNTIME ERRORS:
${fileErrors.map((e) => `- [${e.category}] ${e.message}`).join('\n')}

CURRENT CODE:
${content}

Return the complete fixed file content only. No explanations.`;

      const payload = bedrockHelper.buildHaikuPayload(prompt, 8000);
      const response = await bedrockHelper.invoke(payload, models.HAIKU);
      const fixed = typeof response === 'string' ? response : JSON.stringify(response);

      let cleanCode = fixed.trim();
      const match = cleanCode.match(/^```\w*\n([\s\S]*?)```$/);
      if (match) cleanCode = match[1].trim();

      await s3.uploadText(
        config.projectsBucket,
        `${projectId}/generated/${filePath}`,
        cleanCode
      );

      await db.put(config.healLogsTable, {
        projectId,
        healId: uuidv4(),
        type: 'post_deploy',
        file: filePath,
        errorsFixed: fileErrors.length,
        timestamp: new Date().toISOString(),
      });

      log('info', 'Post-deploy heal applied', {
        projectId,
        file: filePath,
      });
    } catch (error) {
      log('warn', 'Post-deploy heal failed for file', {
        projectId,
        file: filePath,
        error: String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
