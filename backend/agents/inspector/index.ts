// ============================================================================
// LAZARUS — Inspector Agent (Agent 1)
// Scans GitHub repos, parses files, detects tech stack, extracts env vars
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { secrets } from '../../shared/secrets';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { ecsClient } from '../../shared/aws-clients';
import { parseFile } from './astParser';
import { detectStack } from './stackDetector';
import { extractEnvVars, classifyEnvVars } from './envExtractor';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type ProjectAnalysis,
  type FileAnalysis,
  type ClassifiedEnvVar,
  type CloneManifest,
} from '../../shared/types';

export async function handler(event: {
  projectId?: string;
  userId: string;
  githubUrl: string;
  pat?: string;
}): Promise<ProjectAnalysis> {
  const config = getConfig();
  const projectId = event.projectId ?? uuidv4();
  const { userId, githubUrl, pat } = event;

  log('info', 'Inspector Agent starting', { projectId, githubUrl });

  try {
    // 1. Validate GitHub URL
    validateGitHubUrl(githubUrl);

    // 2. Parse repo info
    const { owner, repo, isPrivate } = await parseRepoInfo(githubUrl, pat);

    // 3. Store PAT if provided
    if (pat) {
      await secrets.putSecret(`lazarus/${projectId}/github-pat`, pat);
      log('info', 'PAT stored in Secrets Manager', { projectId });
    }

    // 4. Create project record
    // UPDATE (not put) so we preserve stepFunctionExecutionArn already set by the API handler.
    // Also keep repoUrl for backward-compat with the API response.
    await db.update(config.projectsTable, { projectId }, {
      userId,
      githubUrl,
      repoUrl: githubUrl,
      repoName: repo,
      repoOwner: owner,
      isPrivate,
      status: ProjectStatus.SCANNING,
      currentPhase: PhaseNumber.INSPECT,
      techStack: null,
      fileCount: 0,
      textFileCount: 0,
      binaryFileCount: 0,
      analysisComplete: false,
      envVarsRequired: [],
      envVarsProvided: false,
      migrationPlanVersion: 0,
      generatedFileCount: 0,
      totalFilesToGenerate: 0,
      sandboxIterations: 0,
      sandboxHealthScore: null,
      liveUrl: null,
      serviceArn: null,
      ecrImageUri: null,
      healthScore: null,
      cost: 0,
      completedAt: null,
      failedAt: null,
      failureReason: null,
      userEdits: 0,
      planApprovedAt: null,
    });

    // Also create user-project mapping
    await db.put(config.userProjectsTable, {
      userId,
      projectId,
      repoName: repo,
      githubUrl,
    });

    // 5. Send phase_started WebSocket event
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.INSPECT,
        phaseName: 'Inspector',
        message: 'Scanning repository...',
      })
    );

    // 6. Check for existing clone
    const existingManifest = await checkForExistingClone(projectId);

    if (!existingManifest) {
      // 7. Trigger GitHub MCP to clone repo
      await triggerGitHubMCP(projectId, githubUrl, pat);
    }

    // 8. List cloned files
    const fileList = await listClonedFiles(projectId);
    log('info', 'Files discovered', { projectId, count: fileList.length });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.SCAN_PROGRESS, projectId, {
        totalFiles: fileList.length,
        message: `Found ${fileList.length} files. Analyzing...`,
      })
    );

    // 9. Parse all files
    const analysisResults = await parseAllFiles(projectId, fileList);

    // 10. Detect tech stack
    const stackResult = await detectStack(analysisResults);
    log('info', 'Tech stack detected', {
      projectId,
      framework: stackResult.techStack.framework,
      language: stackResult.techStack.language,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.TECH_STACK_DETECTED, projectId, {
        techStack: stackResult.techStack,
        confidence: stackResult.confidence,
      })
    );

    // 11. Extract and classify env vars
    const rawEnvVars = extractEnvVars(analysisResults);
    const classifiedEnvVars = rawEnvVars.length > 0
      ? await classifyEnvVars(rawEnvVars, stackResult.techStack)
      : [];

    // 12. Build dependency graph
    const dependencyGraph = buildDependencyGraph(analysisResults);
    const circularDeps = detectCircularDependencies(dependencyGraph);
    if (circularDeps.length > 0) {
      log('warn', 'Circular dependencies detected', {
        projectId,
        count: circularDeps.length,
      });
    }

    // 13. Identify entry points
    const entryPoints = analysisResults
      .filter((f) => f.isEntryPoint)
      .map((f) => f.filePath);

    const configFiles = analysisResults
      .filter((f) => f.isConfig)
      .map((f) => f.filePath);

    const testFiles = analysisResults
      .filter((f) => f.isTest)
      .map((f) => f.filePath);

    // Get file counts from manifest
    const manifest = await getManifest(projectId);

    // 14. Update project record
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.SCAN_COMPLETE,
      techStack: stackResult.techStack,
      fileCount: manifest?.totalFiles ?? fileList.length,
      textFileCount: manifest?.textFiles ?? fileList.length,
      binaryFileCount: manifest?.binaryFiles ?? 0,
      analysisComplete: true,
      envVarsRequired: classifiedEnvVars.filter(
        (e) => e.classification === 'SECRET' && e.required
      ),
    });

    // 15. Send phase_complete event
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.INSPECT,
        phaseName: 'Inspector',
        message: `Scan complete. ${fileList.length} files analyzed.`,
        techStack: stackResult.techStack,
      })
    );

    // 16. Build and return complete ProjectAnalysis
    const analysis: ProjectAnalysis = {
      projectId,
      githubUrl,
      repoName: repo,
      repoOwner: owner,
      isPrivate,
      techStack: stackResult.techStack,
      files: analysisResults,
      totalFiles: manifest?.totalFiles ?? fileList.length,
      textFiles: manifest?.textFiles ?? fileList.length,
      binaryFiles: manifest?.binaryFiles ?? 0,
      totalLines: analysisResults.reduce((sum, f) => sum + f.lineCount, 0),
      envVars: classifiedEnvVars,
      dependencyGraph,
      circularDependencies: circularDeps,
      entryPoints,
      configFiles,
      testFiles,
    };

    // Check if env vars need user input
    const secretEnvVars = classifiedEnvVars.filter(
      (v) => v.classification === 'SECRET' && v.required
    );

    return {
      ...analysis,
      // Signal to Step Functions if env vars are needed
      ...(secretEnvVars.length > 0
        ? { envVarsRequired: true as unknown as ClassifiedEnvVar[] }
        : { envVarsRequired: false as unknown as ClassifiedEnvVar[] }),
    };
  } catch (error) {
    log('error', 'Inspector Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: String(error),
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.INSPECT,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// URL Validation
// ---------------------------------------------------------------------------

function validateGitHubUrl(url: string): void {
  const pattern = /^https?:\/\/(www\.)?github\.com\/[\w\-._]+\/[\w\-._]+(\.git)?$/;
  if (!pattern.test(url)) {
    throw new Error(`Invalid GitHub URL format: ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Repo Info Parser
// ---------------------------------------------------------------------------

async function parseRepoInfo(
  url: string,
  pat?: string
): Promise<{ owner: string; repo: string; isPrivate: boolean }> {
  const match = url.match(/github\.com\/([\w\-._]+)\/([\w\-._]+)/);
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${url}`);
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, '');

  // Check if repo is private via GitHub API
  let isPrivate = false;
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Lazarus/1.0',
    };
    if (pat) {
      headers['Authorization'] = `Bearer ${pat}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json() as { private?: boolean };
      isPrivate = data.private ?? false;
    } else if (response.status === 404 && !pat) {
      // Might be private repo — need PAT
      throw new Error(
        'Repository not found. If this is a private repo, please provide a Personal Access Token (PAT).'
      );
    }
  } catch (error) {
    if ((error as Error).message.includes('PAT')) throw error;
    log('warn', 'GitHub API check failed, continuing', { error: String(error) });
  }

  return { owner, repo, isPrivate };
}

// ---------------------------------------------------------------------------
// Clone operations
// ---------------------------------------------------------------------------

async function checkForExistingClone(projectId: string): Promise<CloneManifest | null> {
  const config = getConfig();
  try {
    const content = await s3.download(
      config.projectsBucket,
      `${projectId}/original/_lazarus_manifest.json`
    );
    return JSON.parse(content) as CloneManifest;
  } catch {
    return null;
  }
}

async function getManifest(projectId: string): Promise<CloneManifest | null> {
  return checkForExistingClone(projectId);
}

async function triggerGitHubMCP(
  projectId: string,
  githubUrl: string,
  pat?: string
): Promise<void> {
  const config = getConfig();

  log('info', 'Triggering GitHub MCP ECS task', { projectId });

  const environment = [
    { name: 'PROJECT_ID', value: projectId },
    { name: 'GITHUB_URL', value: githubUrl },
    { name: 'S3_BUCKET', value: config.projectsBucket },
    { name: 'AWS_REGION', value: config.region },
  ];

  if (pat) {
    environment.push({ name: 'GITHUB_PAT', value: pat });
  }

  const runResult = await ecsClient.send(
    new RunTaskCommand({
      cluster: config.ecsClusterArn,
      taskDefinition: config.githubMcpTaskDef,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.vpcSubnets.split(','),
          securityGroups: [config.securityGroup],
          // DISABLED = correct for private subnets; NAT gateway provides outbound internet
          assignPublicIp: 'DISABLED',
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: 'github-mcp',
            environment,
          },
        ],
      },
    })
  );

  const taskArn = runResult.tasks?.[0]?.taskArn;
  if (!taskArn) {
    throw new Error('Failed to start GitHub MCP ECS task');
  }

  log('info', 'ECS task started, polling', { projectId, taskArn });

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes at 5-second intervals

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
    if (!task) {
      throw new Error('ECS task not found');
    }

    const status = task.lastStatus;

    if (status === 'STOPPED') {
      const container = task.containers?.[0];
      const exitCode = container?.exitCode;

      if (exitCode !== 0) {
        const reason = container?.reason ?? task.stoppedReason ?? 'Unknown error';
        throw new Error(`GitHub MCP failed with exit code ${exitCode}: ${reason}`);
      }

      log('info', 'GitHub MCP completed successfully', { projectId });

      // Track ECS cost
      const startedAt = task.startedAt?.getTime() ?? Date.now();
      const stoppedAt = task.stoppedAt?.getTime() ?? Date.now();
      const durationSeconds = (stoppedAt - startedAt) / 1000;
      await costTracker.record(
        projectId,
        'ecs_fargate',
        512, // CPU units
        1024, // Memory MB
        'github_clone',
        { durationSeconds: String(Math.round(durationSeconds)) }
      );

      return;
    }

    if (status === 'PROVISIONING' || status === 'PENDING' || status === 'RUNNING') {
      continue;
    }
  }

  throw new Error('GitHub MCP timed out after 10 minutes');
}

// ---------------------------------------------------------------------------
// File listing and parsing
// ---------------------------------------------------------------------------

async function listClonedFiles(projectId: string): Promise<string[]> {
  const config = getConfig();
  const prefix = `${projectId}/original/`;
  const keys = await s3.list(config.projectsBucket, prefix);

  return keys
    .map((k) => k.substring(prefix.length))
    .filter((k) => k && !k.startsWith('_lazarus_') && !k.endsWith('/'));
}

async function parseAllFiles(
  projectId: string,
  fileList: string[]
): Promise<FileAnalysis[]> {
  const config = getConfig();
  const results: FileAnalysis[] = [];

  for (const filePath of fileList) {
    try {
      const content = await s3.download(
        config.projectsBucket,
        `${projectId}/original/${filePath}`
      );

      const analysis = parseFile(filePath, content);
      if (analysis) {
        results.push(analysis);
      }

      // Send progress periodically
      if (results.length % 50 === 0) {
        await ws.send(
          projectId,
          WebSocketHelper.createEvent(
            WebSocketEventType.SCAN_PROGRESS,
            projectId,
            {
              analyzedFiles: results.length,
              totalFiles: fileList.length,
              message: `Analyzed ${results.length}/${fileList.length} files...`,
            }
          )
        );
      }
    } catch (error) {
      log('warn', 'Failed to parse file', {
        projectId,
        filePath,
        error: String(error),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Dependency graph
// ---------------------------------------------------------------------------

function buildDependencyGraph(
  files: FileAnalysis[]
): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  const filePathSet = new Set(files.map((f) => f.filePath));

  for (const file of files) {
    const deps: string[] = [];

    for (const imp of file.imports) {
      // Resolve relative imports
      if (imp.source.startsWith('.') || imp.source.startsWith('/')) {
        const resolved = resolveImportPath(file.filePath, imp.source, filePathSet);
        if (resolved) {
          deps.push(resolved);
        }
      }
    }

    graph[file.filePath] = deps;
  }

  return graph;
}

function resolveImportPath(
  fromFile: string,
  importPath: string,
  allFiles: Set<string>
): string | null {
  const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  let resolved: string;

  if (importPath.startsWith('./')) {
    resolved = `${dir}/${importPath.substring(2)}`;
  } else if (importPath.startsWith('../')) {
    const parts = dir.split('/');
    parts.pop();
    resolved = `${parts.join('/')}/${importPath.substring(3)}`;
  } else {
    resolved = importPath;
  }

  // Try extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

  if (allFiles.has(resolved)) return resolved;

  for (const ext of extensions) {
    if (allFiles.has(resolved + ext)) return resolved + ext;
  }

  return null;
}

function detectCircularDependencies(
  graph: Record<string, string[]>
): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): void {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart));
      }
      return;
    }

    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const dep of graph[node] ?? []) {
      dfs(dep);
    }

    stack.delete(node);
    path.pop();
  }

  for (const node of Object.keys(graph)) {
    dfs(node);
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
