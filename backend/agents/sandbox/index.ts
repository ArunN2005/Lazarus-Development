// ============================================================================
// LAZARUS — Sandbox Agent (Agent 4) — Orchestrator
// Manages ECS Fargate sandbox containers for build/test/heal cycles
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { ecsClient } from '../../shared/aws-clients';
import { classifyLogBatch, getFixStrategy } from '../../shared/errorClassifier';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type SandboxResult,
  type SandboxIteration,
  type ClassifiedError,
} from '../../shared/types';

const MAX_ITERATIONS = 10;
const SANDBOX_TIMEOUT_MS = 300_000; // 5 minutes per iteration

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: {
  projectId: string;
}): Promise<SandboxResult> {
  const config = getConfig();
  const { projectId } = event;

  log('info', 'Sandbox Agent starting', { projectId });

  try {
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.SANDBOX_RUNNING,
      currentPhase: PhaseNumber.SANDBOX,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.SANDBOX,
        phaseName: 'Sandbox',
        message: 'Starting sandbox environment...',
      })
    );

    let iteration = 0;
    let healthy = false;
    let lastErrors: ClassifiedError[] = [];
    const allIterations: SandboxIteration[] = [];

    while (iteration < MAX_ITERATIONS && !healthy) {
      iteration++;

      log('info', `Sandbox iteration ${iteration}`, { projectId });

      await ws.send(
        projectId,
        WebSocketHelper.createEvent(WebSocketEventType.SANDBOX_ITERATION, projectId, {
          iteration,
          maxIterations: MAX_ITERATIONS,
          message: `Sandbox iteration ${iteration}/${MAX_ITERATIONS}`,
        })
      );

      // 1. Run sandbox container
      const result = await runSandboxContainer(projectId, iteration);

      // 2. Classify errors
      if (!result.success && result.logs) {
        lastErrors = classifyLogBatch(result.logs);
      } else {
        lastErrors = [];
      }

      // 3. Record iteration
      const iterationRecord: SandboxIteration = {
        projectId,
        iterationNumber: iteration,
        step: 'install',
        success: result.success,
        errorCategory: lastErrors.length > 0 ? lastErrors[0].category : null,
        errorMessage: lastErrors.length > 0 ? lastErrors[0].rawMessage : null,
        affectedFile: lastErrors.length > 0 ? lastErrors[0].affectedFile : null,
        fixStrategy: null,
        fixApplied: null,
        patchedFiles: [],
        healthScore: result.healthCheckPassed ? 100 : null,
        durationMs: 0,
        tokensUsed: 0,
        cost: 0,
        timestamp: new Date().toISOString(),
        iteration,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        installSuccess: result.installSuccess,
        buildSuccess: result.buildSuccess,
        startSuccess: result.startSuccess,
        healthCheckPassed: result.healthCheckPassed,
        errors: lastErrors,
        fixesApplied: [],
        logs: result.logs.slice(0, 200), // Truncate for DynamoDB
      };

      allIterations.push(iterationRecord);

      await db.put(config.sandboxIterationsTable, {
        iteration,
        ...iterationRecord,
      });

      // 4. Check if healthy
      if (result.healthCheckPassed) {
        healthy = true;
        log('info', 'Sandbox health check passed!', { projectId, iteration });
        break;
      }

      // 5. If not healthy, attempt fixes
      if (lastErrors.length > 0 && iteration < MAX_ITERATIONS) {
        const fixResult = await attemptFixes(projectId, lastErrors, iteration);

        iterationRecord.fixesApplied = fixResult.appliedFixes;

        await ws.send(
          projectId,
          WebSocketHelper.createEvent(WebSocketEventType.SANDBOX_FIX, projectId, {
            iteration,
            errors: lastErrors.length,
            fixes: fixResult.appliedFixes.length,
            message: `Applied ${fixResult.appliedFixes.length} fixes for ${lastErrors.length} errors`,
          })
        );

        if (fixResult.appliedFixes.length === 0) {
          log('warn', 'No fixes could be applied', { projectId, iteration });
          // Try AI-based surgical fix
          await attemptAIFix(projectId, lastErrors);
        }
      }
    }

    // Update project
    const finalStatus = healthy
      ? ProjectStatus.SANDBOX_PASSED
      : ProjectStatus.SANDBOX_FAILED;

    await db.update(config.projectsTable, { projectId }, {
      status: finalStatus,
      sandboxIterations: iteration,
      sandboxHealthScore: healthy ? 100 : calculateHealthScore(allIterations),
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.SANDBOX,
        phaseName: 'Sandbox',
        healthy,
        iterations: iteration,
        message: healthy
          ? `Sandbox passed in ${iteration} iteration(s)!`
          : `Sandbox failed after ${iteration} iterations.`,
      })
    );

    return {
      projectId,
      success: healthy,
      iterations: iteration,
      finalHealthScore: healthy ? 100 : calculateHealthScore(allIterations),
      errors: lastErrors,
      fixesApplied: [],
      totalCost: 0,
      durationMs: 0,
      healthy,
      lastErrors,
      allIterations,
    };
  } catch (error) {
    log('error', 'Sandbox Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: `Sandbox: ${String(error)}`,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.SANDBOX,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Sandbox container management
// ---------------------------------------------------------------------------

interface ContainerResult {
  success: boolean;
  installSuccess: boolean;
  buildSuccess: boolean;
  startSuccess: boolean;
  healthCheckPassed: boolean;
  logs: string[];
  startedAt: string;
  completedAt: string;
}

async function runSandboxContainer(
  projectId: string,
  iteration: number
): Promise<ContainerResult> {
  const config = getConfig();
  const startedAt = new Date().toISOString();

  const runResult = await ecsClient.send(
    new RunTaskCommand({
      cluster: config.ecsClusterArn,
      taskDefinition: config.sandboxTaskDef,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.vpcSubnets.split(','),
          securityGroups: [config.securityGroup],
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'sandbox',
            environment: [
              { name: 'PROJECT_ID', value: projectId },
              { name: 'ITERATION', value: String(iteration) },
              { name: 'S3_BUCKET', value: config.projectsBucket },
              { name: 'AWS_REGION', value: config.region },
            ],
          },
        ],
      },
    })
  );

  const taskArn = runResult.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new Error('Failed to start sandbox ECS task');
  }

  log('info', 'Sandbox ECS task started', { projectId, taskArn, iteration });

  // Poll for completion
  let attempts = 0;
  const maxAttempts = Math.ceil(SANDBOX_TIMEOUT_MS / 5000);

  while (attempts < maxAttempts) {
    await sleep(5000);
    attempts++;

    const describeResult = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.ecsClusterArn,
        tasks: [taskArn],
      })
    );

    const task = describeResult.tasks?.[0];
    if (!task) throw new Error('ECS task not found');

    if (task.lastStatus === 'STOPPED') {
      const container = task.containers?.[0];
      const exitCode = container?.exitCode ?? -1;

      // Fetch logs from S3 (the sandbox container writes logs there)
      const logs = await fetchSandboxLogs(projectId, iteration);

      // Track cost
      const taskStartedAt = task.startedAt?.getTime() ?? Date.now();
      const taskStoppedAt = task.stoppedAt?.getTime() ?? Date.now();
      const durationSeconds = (taskStoppedAt - taskStartedAt) / 1000;
      await costTracker.record(
        projectId,
        'ecs_fargate',
        1024, // 1 vCPU
        2048, // 2 GB
        'sandbox_run',
        { iteration: String(iteration), durationSeconds: String(Math.round(durationSeconds)) }
      );

      const completedAt = new Date().toISOString();

      // Parse exit code to determine which stages passed
      // Convention: exit code encodes stage failures
      // 0 = all passed, 1 = install failed, 2 = build failed,
      // 3 = start failed, 4 = health check failed
      return {
        success: exitCode === 0,
        installSuccess: exitCode !== 1,
        buildSuccess: exitCode !== 1 && exitCode !== 2,
        startSuccess: exitCode !== 1 && exitCode !== 2 && exitCode !== 3,
        healthCheckPassed: exitCode === 0,
        logs,
        startedAt,
        completedAt,
      };
    }

    if (['PROVISIONING', 'PENDING', 'RUNNING'].includes(task.lastStatus ?? '')) {
      continue;
    }
  }

  return {
    success: false,
    installSuccess: false,
    buildSuccess: false,
    startSuccess: false,
    healthCheckPassed: false,
    logs: ['Sandbox timed out'],
    startedAt,
    completedAt: new Date().toISOString(),
  };
}

async function fetchSandboxLogs(projectId: string, iteration: number): Promise<string[]> {
  const config = getConfig();
  try {
    const content = await s3.download(
      config.projectsBucket,
      `${projectId}/sandbox/iteration-${iteration}/logs.txt`
    );
    return content.split('\n').filter(Boolean);
  } catch {
    return ['No logs available'];
  }
}

// ---------------------------------------------------------------------------
// Fix engine
// ---------------------------------------------------------------------------

interface FixResult {
  appliedFixes: string[];
  failedFixes: string[];
}

async function attemptFixes(
  projectId: string,
  errors: ClassifiedError[],
  iteration: number
): Promise<FixResult> {
  const config = getConfig();
  const appliedFixes: string[] = [];
  const failedFixes: string[] = [];

  for (const error of errors) {
    const strategy = getFixStrategy(error.category);

    try {
      switch (strategy) {
        case 'install_package': {
          // Extract package name from error
          const packageMatch = error.message?.match(
            /Cannot find (?:module|package) ['"](@?[\w\-/]+)['"]/
          );
          if (packageMatch) {
            const packageName = packageMatch[1];
            await addDependency(projectId, packageName);
            appliedFixes.push(`Added dependency: ${packageName}`);
          }
          break;
        }

        case 'fix_version': {
          const versionMatch = error.message?.match(
            /requires (?:peer )?(?:dependency )['"](@?[\w\-/]+)@(.+)['"]/
          );
          if (versionMatch) {
            await updateDependencyVersion(projectId, versionMatch[1], versionMatch[2]);
            appliedFixes.push(`Updated ${versionMatch[1]} to ${versionMatch[2]}`);
          }
          break;
        }

        case 'add_type_package': {
          const typeMatch = error.message?.match(
            /Could not find a declaration file for module ['"](@?[\w\-/]+)['"]/
          );
          if (typeMatch) {
            const typePkg = `@types/${typeMatch[1].replace('@', '').replace('/', '__')}`;
            await addDevDependency(projectId, typePkg);
            appliedFixes.push(`Added type definitions: ${typePkg}`);
          }
          break;
        }

        case 'fix_import': {
          // Let the AI handle import fixes
          break;
        }

        case 'add_env_var': {
          const envMatch = error.message?.match(
            /(?:Missing|undefined).*(?:environment variable|env var).*['"](\w+)['"]/i
          );
          if (envMatch) {
            await addEnvVar(projectId, envMatch[1]);
            appliedFixes.push(`Added env var placeholder: ${envMatch[1]}`);
          }
          break;
        }

        case 'fix_port': {
          await fixPortConflict(projectId);
          appliedFixes.push('Fixed port conflict');
          break;
        }

        case 'fix_config': {
          // Config fixes need AI
          break;
        }

        default:
          // Complex fixes handled by AI
          break;
      }
    } catch (fixError) {
      failedFixes.push(`${strategy}: ${String(fixError)}`);
    }
  }

  // Log fixes
  for (const fix of appliedFixes) {
    await db.put(config.healLogsTable, {
      projectId,
      healId: uuidv4(),
      iteration,
      type: 'deterministic',
      description: fix,
      timestamp: new Date().toISOString(),
    });
  }

  return { appliedFixes, failedFixes };
}

// ---------------------------------------------------------------------------
// AI-based surgical fixes
// ---------------------------------------------------------------------------

async function attemptAIFix(
  projectId: string,
  errors: ClassifiedError[]
): Promise<void> {
  const config = getConfig();
  const { bedrock: bedrockHelper, MODELS: models } = await import('../../shared/bedrock');

  // Group errors by file
  const errorsByFile = new Map<string, ClassifiedError[]>();
  for (const error of errors) {
    const file = error.file ?? 'unknown';
    if (!errorsByFile.has(file)) errorsByFile.set(file, []);
    errorsByFile.get(file)!.push(error);
  }

  for (const [filePath, fileErrors] of errorsByFile) {
    if (filePath === 'unknown') continue;

    // Load the file
    let content: string;
    try {
      content = await s3.download(
        config.projectsBucket,
        `${projectId}/generated/${filePath}`
      );
    } catch {
      continue;
    }

    const prompt = `Fix these errors in the file. Return ONLY the complete corrected file content.

FILE: ${filePath}

ERRORS:
${fileErrors.map((e) => `- Line ${e.line ?? '?'}: [${e.category}] ${e.message}`).join('\n')}

CURRENT CONTENT:
${content}

Return the complete fixed file. No explanations, no markdown.`;

    try {
      const payload = bedrockHelper.buildSonnetPayload(
        'You are a code repair engine. Fix the errors and return the complete corrected file.',
        prompt,
        8000
      );
      const response = await bedrockHelper.invoke(payload, models.SONNET);
      const fixed = typeof response === 'string' ? response : JSON.stringify(response);

      // Strip markdown if present
      let cleanCode = fixed.trim();
      const codeBlockMatch = cleanCode.match(/^```\w*\n([\s\S]*?)```$/);
      if (codeBlockMatch) {
        cleanCode = codeBlockMatch[1].trim();
      }

      // Upload fixed file
      await s3.uploadText(
        config.projectsBucket,
        `${projectId}/generated/${filePath}`,
        cleanCode
      );

      await db.put(config.healLogsTable, {
        projectId,
        healId: uuidv4(),
        type: 'ai_surgical',
        file: filePath,
        errorsFixed: fileErrors.length,
        timestamp: new Date().toISOString(),
      });

      log('info', 'AI fix applied', { projectId, file: filePath, errors: fileErrors.length });
    } catch (error) {
      log('error', 'AI fix failed', {
        projectId,
        file: filePath,
        error: String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic fix helpers
// ---------------------------------------------------------------------------

async function addDependency(projectId: string, packageName: string): Promise<void> {
  await modifyPackageJson(projectId, (pkg) => {
    if (!pkg.dependencies) pkg.dependencies = {};
    pkg.dependencies[packageName] = 'latest';
    return pkg;
  });
}

async function addDevDependency(projectId: string, packageName: string): Promise<void> {
  await modifyPackageJson(projectId, (pkg) => {
    if (!pkg.devDependencies) pkg.devDependencies = {};
    pkg.devDependencies[packageName] = 'latest';
    return pkg;
  });
}

async function updateDependencyVersion(
  projectId: string,
  packageName: string,
  version: string
): Promise<void> {
  await modifyPackageJson(projectId, (pkg) => {
    if (pkg.dependencies?.[packageName]) {
      pkg.dependencies[packageName] = version;
    }
    if (pkg.devDependencies?.[packageName]) {
      pkg.devDependencies[packageName] = version;
    }
    return pkg;
  });
}

async function addEnvVar(projectId: string, varName: string): Promise<void> {
  const config = getConfig();

  // Add to .env file
  try {
    let envContent = '';
    try {
      envContent = await s3.download(
        config.projectsBucket,
        `${projectId}/generated/.env`
      );
    } catch {
      // File doesn't exist yet
    }

    if (!envContent.includes(varName)) {
      envContent += `\n${varName}=placeholder`;
      await s3.uploadText(
        config.projectsBucket,
        `${projectId}/generated/.env`,
        envContent.trim()
      );
    }
  } catch (error) {
    log('warn', 'Failed to add env var', { projectId, varName, error: String(error) });
  }
}

async function fixPortConflict(projectId: string): Promise<void> {
  // Change the port to 3000 (standard) in common config locations
  const config = getConfig();
  const possibleFiles = ['.env', 'next.config.js', 'next.config.ts', 'vite.config.ts', 'server.ts', 'server.js'];

  for (const file of possibleFiles) {
    try {
      const content = await s3.download(
        config.projectsBucket,
        `${projectId}/generated/${file}`
      );

      const fixed = content.replace(/PORT\s*=\s*\d+/, 'PORT=3000');
      if (fixed !== content) {
        await s3.uploadText(
          config.projectsBucket,
          `${projectId}/generated/${file}`,
          fixed
        );
      }
    } catch {
      // File doesn't exist
    }
  }
}

async function modifyPackageJson(
  projectId: string,
  modifier: (pkg: Record<string, any>) => Record<string, any>
): Promise<void> {
  const config = getConfig();
  const key = `${projectId}/generated/package.json`;

  let pkg: Record<string, any>;
  try {
    const content = await s3.download(config.projectsBucket, key);
    pkg = JSON.parse(content);
  } catch {
    pkg = { name: 'migrated-app', version: '1.0.0', dependencies: {}, devDependencies: {} };
  }

  pkg = modifier(pkg);

  await s3.uploadText(config.projectsBucket, key, JSON.stringify(pkg, null, 2));
}

// ---------------------------------------------------------------------------
// Health score calculation
// ---------------------------------------------------------------------------

function calculateHealthScore(iterations: SandboxIteration[]): number {
  if (iterations.length === 0) return 0;

  const last = iterations[iterations.length - 1];
  let score = 0;

  if (last.installSuccess) score += 25;
  if (last.buildSuccess) score += 25;
  if (last.startSuccess) score += 25;
  if (last.healthCheckPassed) score += 25;

  return score;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
