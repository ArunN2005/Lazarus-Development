// ============================================================================
// LAZARUS — API Handlers
// REST API Lambda handlers for all routes
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { db } from '../shared/dynamodb';
import { s3 } from '../shared/s3';
import { costTracker } from '../shared/costTracker';
import { getConfig } from '../shared/config';
import { log } from '../shared/logger';
import { sfnClient } from '../shared/aws-clients';
import { ProjectStatus } from '../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface APIEvent {
  httpMethod: string;
  path: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  headers?: Record<string, string>;
  requestContext: {
    authorizer?: {
      claims?: {
        sub: string;
        email: string;
      };
    };
  };
}

interface APIResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(statusCode: number, body: unknown): APIResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

function errorResponse(handlerName: string, error: unknown): APIResponse {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errStack = error instanceof Error ? (error.stack ?? '') : '';
  log('error', `${handlerName} failed`, {
    error: errMsg,
    stack: errStack,
    handler: handlerName,
    timestamp: new Date().toISOString(),
  });
  return jsonResponse(500, {
    error: errMsg,
    handler: handlerName,
    timestamp: new Date().toISOString(),
  });
}

function getUserId(event: APIEvent): string {
  return event.requestContext.authorizer?.claims?.sub ?? 'anonymous';
}

// ============================================================================
// POST /projects — Create a new migration project
// ============================================================================

export async function createProject(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const userId = getUserId(event);
    const body = JSON.parse(event.body ?? '{}');

    const { githubUrl, pat } = body;

    if (!githubUrl) {
      return jsonResponse(400, { error: 'githubUrl is required' });
    }

    // Validate URL format
    const urlPattern = /^https?:\/\/(www\.)?github\.com\/[\w\-._]+\/[\w\-._]+(\.git)?$/;
    if (!urlPattern.test(githubUrl)) {
      return jsonResponse(400, { error: 'Invalid GitHub URL format' });
    }

    const projectId = uuidv4();
    const repoName = githubUrl.replace(/\.git$/, '').split('/').slice(-2).join('/');

    // Create initial project record in DynamoDB
    await db.put(config.projectsTable, {
      projectId,
      userId,
      repoUrl: githubUrl,
      repoName,
      status: ProjectStatus.CREATED,
      phase: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Also write to user-projects index table
    await db.put(config.userProjectsTable, {
      userId,
      projectId,
      repoName,
      createdAt: new Date().toISOString(),
    });

    // Start Step Functions execution
    const executionResult = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: config.stateMachineArn,
        name: `lazarus-${projectId}`,
        input: JSON.stringify({
          projectId,
          userId,
          githubUrl,
          pat: pat ?? undefined,
        }),
      })
    );

    // Store execution ARN
    await db.update(config.projectsTable, { projectId }, {
      stepFunctionExecutionArn: executionResult.executionArn,
    });

    log('info', 'Project created', { projectId, githubUrl, userId });

    return jsonResponse(201, {
      projectId,
      status: 'CREATED',
      message: 'Migration started',
    });
  } catch (error) {
    return errorResponse('createProject', error);
  }
}

// ============================================================================
// GET /projects — List user's projects
// ============================================================================

export async function listProjects(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const userId = getUserId(event);

    const userProjects = await db.queryGSI<Record<string, any>>(
      config.userProjectsTable,
      'userId-index',
      'userId',
      userId
    );

    // Fetch full project details
    if (userProjects.length === 0) {
      return jsonResponse(200, { projects: [] });
    }

    const projectIds = userProjects.map((p: Record<string, any>) => ({
      projectId: p.projectId as string,
    }));
    const projects = await db.batchGet(config.projectsTable, projectIds);

    return jsonResponse(200, { projects });
  } catch (error) {
    return errorResponse('listProjects', error);
  }
}

// ============================================================================
// GET /projects/:projectId — Get project details
// ============================================================================

export async function getProject(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const project = await db.get(config.projectsTable, { projectId });

    if (!project) {
      return jsonResponse(404, { error: 'Project not found' });
    }

    return jsonResponse(200, { project });
  } catch (error) {
    return errorResponse('getProject', error);
  }
}

// ============================================================================
// GET /projects/:projectId/plan — Get migration plan
// ============================================================================

export async function getPlan(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const plans = (await db.query(
      config.migrationPlansTable,
      'projectId = :pid',
      projectId
    )).items;

    if (plans.length === 0) {
      return jsonResponse(404, { error: 'No migration plan found' });
    }

    // Return latest version
    const latestPlan = plans.sort(
      (a: Record<string, any>, b: Record<string, any>) => ((b as Record<string, number>).version ?? 0) - ((a as Record<string, number>).version ?? 0)
    )[0];

    return jsonResponse(200, { plan: latestPlan });
  } catch (error) {
    return errorResponse('getPlan', error);
  }
}

// ============================================================================
// POST /projects/:projectId/approve — Approve migration plan
// ============================================================================

export async function approvePlan(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const project = await db.get(config.projectsTable, { projectId });

    if (!project) {
      return jsonResponse(404, { error: 'Project not found' });
    }

    if ((project as Record<string, string>).status !== ProjectStatus.AWAITING_APPROVAL) {
      return jsonResponse(400, { error: 'Project is not awaiting approval' });
    }

    // Update project status
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.APPROVED,
      planApprovedAt: new Date().toISOString(),
    });

    // Resume Step Functions execution
    // The state machine will have a callback task waiting for approval
    // For simplicity, we signal by updating a token in DynamoDB
    await db.update(config.projectsTable, { projectId }, {
      planApprovalToken: 'APPROVED',
    });

    log('info', 'Plan approved', { projectId });

    return jsonResponse(200, { message: 'Plan approved', projectId });
  } catch (error) {
    return errorResponse('approvePlan', error);
  }
}

// ============================================================================
// POST /projects/:projectId/env — Provide environment variables
// ============================================================================

export async function provideEnvVars(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;
    const body = JSON.parse(event.body ?? '{}');

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const { envVars } = body;

    if (!envVars || typeof envVars !== 'object') {
      return jsonResponse(400, { error: 'envVars object is required' });
    }

    // Store env vars securely as a secret
    const { secrets } = await import('../shared/secrets');
    await secrets.putSecretJson(
      `lazarus/${projectId}/env-vars`,
      envVars
    );

    // Upload .env file to generated project
    const envContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await s3.uploadText(
      config.projectsBucket,
      `${projectId}/generated/.env`,
      envContent
    );

    await db.update(config.projectsTable, { projectId }, {
      envVarsProvided: true,
      envVarsToken: 'PROVIDED',
    });

    log('info', 'Env vars provided', { projectId, count: Object.keys(envVars).length });

    return jsonResponse(200, { message: 'Environment variables stored', projectId });
  } catch (error) {
    return errorResponse('provideEnvVars', error);
  }
}

// ============================================================================
// Language detection helper
// ============================================================================

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c',
    html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml',
    yml: 'yaml', md: 'markdown', sh: 'shell', bash: 'shell',
    toml: 'toml', sql: 'sql', dockerfile: 'dockerfile',
  };
  if (filePath.toLowerCase().endsWith('dockerfile')) return 'dockerfile';
  return map[ext] ?? 'text';
}

// ============================================================================
// GET /projects/:projectId/files — List generated files
// ============================================================================

export async function listFiles(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const files = (await db.query(
      config.fileGenerationsTable,
      'projectId',
      projectId
    )).items;

    return jsonResponse(200, {
      files: files.map((f: Record<string, unknown>) => {
        const path = ((f.filePath ?? f.targetPath) as string) || '';
        return {
          filePath: path,
          targetPath: f.targetPath,
          sourcePath: f.sourcePath,
          action: f.action,
          phase: f.phase,
          size: (f.sizeBytes as number) ?? 0,
          sizeBytes: f.sizeBytes,
          generatedAt: f.generatedAt,
          status: 'generated',
          language: detectLanguage(path),
        };
      }),
    });
  } catch (error) {
    return errorResponse('listFiles', error);
  }
}

// ============================================================================
// GET /projects/:projectId/files/:filePath — Get file content
// ============================================================================

export async function getFileContent(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;
    const filePath = event.queryStringParameters?.path;

    if (!projectId || !filePath) {
      return jsonResponse(400, { error: 'projectId and path are required' });
    }

    const content = await s3.download(
      config.projectsBucket,
      `${projectId}/generated/${filePath}`
    );

    return jsonResponse(200, { filePath, content, language: detectLanguage(filePath) });
  } catch (error) {
    return errorResponse('getFileContent', error);
  }
}

// ============================================================================
// PUT /projects/:projectId/files/:filePath — Update file content
// ============================================================================

export async function updateFileContent(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;
    const body = JSON.parse(event.body ?? '{}');

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const { filePath, content } = body;

    if (!filePath || content === undefined) {
      return jsonResponse(400, { error: 'filePath and content are required' });
    }

    await s3.uploadText(
      config.projectsBucket,
      `${projectId}/generated/${filePath}`,
      content
    );

    // Track user edit
    await db.atomicAdd(config.projectsTable, { projectId }, 'userEdits', 1);

    log('info', 'File updated by user', { projectId, filePath });

    return jsonResponse(200, { message: 'File updated', filePath });
  } catch (error) {
    return errorResponse('updateFileContent', error);
  }
}

// ============================================================================
// GET /projects/:projectId/cost — Get cost breakdown
// ============================================================================

export async function getCost(event: APIEvent): Promise<APIResponse> {
  try {
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    const totalCost = await costTracker.getTotalCost(projectId);
    const breakdown = await costTracker.getCostBreakdown(projectId);

    return jsonResponse(200, {
      projectId,
      totalCost,
      breakdown,
    });
  } catch (error) {
    return errorResponse('getCost', error);
  }
}

// ============================================================================
// GET /projects/:projectId/diff — Get diff for a file
// ============================================================================

export async function getDiff(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;
    const filePath = event.queryStringParameters?.path;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    if (filePath) {
      // Get diff for specific file
      const fileGen = await db.get(config.fileGenerationsTable, {
        projectId,
        targetPath: filePath,
      });

      if (!fileGen) {
        return jsonResponse(404, { error: 'File not found' });
      }

      return jsonResponse(200, { diff: (fileGen as Record<string, unknown>).diff });
    }

    // Get all diffs
    const files = (await db.query(
      config.fileGenerationsTable,
      'projectId = :pid',
      projectId
    )).items;

    const diffs = files
      .filter((f: Record<string, unknown>) => f.diff)
      .map((f: Record<string, unknown>) => ({
        targetPath: f.targetPath,
        sourcePath: f.sourcePath,
        diff: f.diff,
      }));

    return jsonResponse(200, { diffs });
  } catch (error) {
    return errorResponse('getDiff', error);
  }
}

// ============================================================================
// POST /projects/:projectId/download — Generate download URL
// ============================================================================

export async function downloadProject(event: APIEvent): Promise<APIResponse> {
  try {
    const config = getConfig();
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return jsonResponse(400, { error: 'projectId is required' });
    }

    // Create a zip of all generated files
    const prefix = `${projectId}/generated/`;
    const files = await s3.list(config.projectsBucket, prefix);

    if (files.length === 0) {
      return jsonResponse(404, { error: 'No generated files found' });
    }

    // Generate presigned URL for the zip (or generate zip first)
    const zipKey = `${projectId}/downloads/project.zip`;
    await s3.zipAndUpload(prefix, config.projectsBucket, zipKey);

    const downloadUrl = await s3.getPresignedUrl(config.projectsBucket, zipKey, 3600);

    return jsonResponse(200, {
      downloadUrl,
      expiresIn: 3600,
      fileCount: files.length,
    });
  } catch (error) {
    return errorResponse('downloadProject', error);
  }
}

// ============================================================================
// Lambda Router Handler
// ============================================================================

export async function handler(event: APIEvent): Promise<APIResponse> {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, {});
  }

  const method = event.httpMethod;
  const path = event.path;

  // Extract path parameters from the URL and inject into event.pathParameters
  // API Gateway proxy integration doesn't populate pathParameters for catch-all routes.
  const projectIdMatch = path.match(/^\/projects\/([^/]+)/);
  if (projectIdMatch) {
    event.pathParameters = { ...(event.pathParameters ?? {}), projectId: projectIdMatch[1] };
  }
  const filePathMatch = path.match(/^\/projects\/[^/]+\/files?\/(.+)$/);
  if (filePathMatch) {
    event.pathParameters = { ...(event.pathParameters ?? {}), filePath: filePathMatch[1] };
  }

  try {
    // Route matching
    if (method === 'POST' && path === '/projects') {
      return await createProject(event);
    }

    if (method === 'GET' && path === '/projects') {
      return await listProjects(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+$/)) {
      return await getProject(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+\/plan$/)) {
      return await getPlan(event);
    }

    if (method === 'POST' && path.match(/^\/projects\/[^/]+\/approve$/)) {
      return await approvePlan(event);
    }

    if (method === 'POST' && path.match(/^\/projects\/[^/]+\/env$/)) {
      return await provideEnvVars(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+\/files$/)) {
      return await listFiles(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+\/file$/)) {
      return await getFileContent(event);
    }

    if (method === 'PUT' && path.match(/^\/projects\/[^/]+\/file$/)) {
      return await updateFileContent(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+\/cost$/)) {
      return await getCost(event);
    }

    if (method === 'GET' && path.match(/^\/projects\/[^/]+\/diff$/)) {
      return await getDiff(event);
    }

    if (method === 'POST' && path.match(/^\/projects\/[^/]+\/download$/)) {
      return await downloadProject(event);
    }

    return jsonResponse(404, { error: 'Not found' });
  } catch (error) {
    return errorResponse(`router:${method}:${path}`, error);
  }
}
