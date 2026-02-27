// ============================================================================
// LAZARUS — Deployer Agent (Agent 5)
// Builds Docker image via CodeBuild, pushes to ECR, deploys to App Runner
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import {
  StartBuildCommand,
  BatchGetBuildsCommand,
} from '@aws-sdk/client-codebuild';
import {
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServiceCommand,
  ListServicesCommand,
} from '@aws-sdk/client-apprunner';
import {
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
} from '@aws-sdk/client-ecr';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import {
  codebuildClient,
  ecrClient,
  appRunnerClient,
} from '../../shared/aws-clients';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type DeployResult,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: {
  projectId: string;
}): Promise<DeployResult> {
  const config = getConfig();
  const { projectId } = event;

  log('info', 'Deployer Agent starting', { projectId });

  try {
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.DEPLOYING,
      currentPhase: PhaseNumber.DEPLOY,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.DEPLOY,
        phaseName: 'Deployer',
        message: 'Preparing deployment...',
      })
    );

    // 1. Generate Dockerfile if not present
    await ensureDockerfile(projectId);

    // 2. Inject Lazarus overlay
    await injectOverlay(projectId);

    // 3. Ensure ECR repository exists
    const ecrRepoUri = await ensureECRRepo(projectId);

    // 4. Trigger CodeBuild
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.DEPLOY_PROGRESS, projectId, {
        step: 'codebuild',
        message: 'Building Docker image...',
      })
    );

    const imageUri = await runCodeBuild(projectId, ecrRepoUri);

    // 5. Deploy to App Runner
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.DEPLOY_PROGRESS, projectId, {
        step: 'apprunner',
        message: 'Deploying to App Runner...',
      })
    );

    const { serviceUrl, serviceArn } = await deployToAppRunner(
      projectId,
      imageUri
    );

    // 6. Update project
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.DEPLOYED,
      liveUrl: serviceUrl,
      serviceArn,
      ecrImageUri: imageUri,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.DEPLOY,
        phaseName: 'Deployer',
        liveUrl: serviceUrl,
        message: `Deployed successfully! URL: ${serviceUrl}`,
      })
    );

    return {
      projectId,
      liveUrl: serviceUrl,
      serviceArn,
      ecrImageUri: imageUri,
      imageUri,
      buildDurationMs: 0,
      deployDurationMs: 0,
      totalDurationMs: 0,
      cost: 0,
      success: true,
    };
  } catch (error) {
    log('error', 'Deployer Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: `Deployer: ${String(error)}`,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.DEPLOY,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dockerfile generation
// ---------------------------------------------------------------------------

async function ensureDockerfile(projectId: string): Promise<void> {
  const config = getConfig();
  const dockerfilePath = `${projectId}/generated/Dockerfile`;

  const exists = await s3.exists(config.projectsBucket, dockerfilePath);
  if (exists) {
    log('info', 'Dockerfile already exists', { projectId });
    return;
  }

  // Load project info to generate appropriate Dockerfile
  const project = await db.get(config.projectsTable, { projectId });
  const techStack = project?.techStack;

  let dockerfile: string;

  if (techStack?.framework === 'Next.js') {
    dockerfile = generateNextDockerfile();
  } else if (techStack?.framework === 'React' || techStack?.framework === 'Vue.js') {
    dockerfile = generateSPADockerfile();
  } else if (techStack?.runtime === 'Node.js') {
    dockerfile = generateNodeDockerfile();
  } else if (techStack?.runtime === 'Python') {
    dockerfile = generatePythonDockerfile();
  } else {
    dockerfile = generateNodeDockerfile(); // Default
  }

  await s3.uploadText(config.projectsBucket, dockerfilePath, dockerfile);
  log('info', 'Generated Dockerfile', { projectId });
}

function generateNextDockerfile(): string {
  return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm install --frozen-lockfile; \\
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
    else npm ci --legacy-peer-deps; fi

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
`;
}

function generateSPADockerfile(): string {
  return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm install --frozen-lockfile; \\
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
    else npm ci --legacy-peer-deps; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/build /usr/share/nginx/html
RUN echo 'server { listen 3000; location / { root /usr/share/nginx/html; try_files $uri /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
`;
}

function generateNodeDockerfile(): string {
  return `FROM node:20-alpine
WORKDIR /app
COPY package*.json yarn.lock* pnpm-lock.yaml* ./
RUN if [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm install --frozen-lockfile; \\
    elif [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
    else npm ci --legacy-peer-deps; fi
COPY . .
RUN if [ -f tsconfig.json ]; then npm run build || true; fi
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
`;
}

function generatePythonDockerfile(): string {
  return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt* Pipfile* pyproject.toml* ./
RUN if [ -f requirements.txt ]; then pip install -r requirements.txt; \\
    elif [ -f Pipfile ]; then pip install pipenv && pipenv install --system; \\
    elif [ -f pyproject.toml ]; then pip install .; fi
COPY . .
EXPOSE 3000
ENV PORT=3000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "3000"]
`;
}

// ---------------------------------------------------------------------------
// Lazarus Overlay injection
// ---------------------------------------------------------------------------

async function injectOverlay(projectId: string): Promise<void> {
  const config = getConfig();

  // Check if overlay already exists in the project
  const overlayPath = `${projectId}/generated/lazarus-overlay.js`;
  const exists = await s3.exists(config.projectsBucket, overlayPath);

  if (!exists) {
    // Copy overlay from config bucket
    try {
      const overlayContent = await s3.download(
        config.configBucket,
        'overlay/lazarus-overlay.js'
      );
      await s3.uploadText(config.projectsBucket, overlayPath, overlayContent);
      log('info', 'Injected Lazarus overlay', { projectId });
    } catch {
      log('warn', 'Overlay not found in config bucket, skipping', { projectId });
    }
  }
}

// ---------------------------------------------------------------------------
// ECR Repository
// ---------------------------------------------------------------------------

async function ensureECRRepo(projectId: string): Promise<string> {
  const config = getConfig();
  const repoName = `lazarus/${projectId.substring(0, 8)}`;

  try {
    const describeResult = await ecrClient.send(
      new DescribeRepositoriesCommand({
        repositoryNames: [repoName],
      })
    );

    return describeResult.repositories?.[0]?.repositoryUri ?? '';
  } catch (error) {
    if ((error as { name?: string }).name === 'RepositoryNotFoundException') {
      const createResult = await ecrClient.send(
        new CreateRepositoryCommand({
          repositoryName: repoName,
          imageScanningConfiguration: { scanOnPush: true },
          imageTagMutability: 'MUTABLE',
        })
      );

      const uri = createResult.repository?.repositoryUri ?? '';
      log('info', 'Created ECR repository', { projectId, repoName, uri });
      return uri;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// CodeBuild
// ---------------------------------------------------------------------------

async function runCodeBuild(
  projectId: string,
  ecrRepoUri: string
): Promise<string> {
  const config = getConfig();
  const imageTag = `${projectId.substring(0, 8)}-${Date.now()}`;
  const imageUri = `${ecrRepoUri}:${imageTag}`;

  const buildResult = await codebuildClient.send(
    new StartBuildCommand({
      projectName: config.codebuildProject ?? config.codeBuildProject,
      environmentVariablesOverride: [
        { name: 'PROJECT_ID', value: projectId, type: 'PLAINTEXT' },
        { name: 'ECR_REPO_URI', value: ecrRepoUri, type: 'PLAINTEXT' },
        { name: 'IMAGE_TAG', value: imageTag, type: 'PLAINTEXT' },
        { name: 'S3_BUCKET', value: config.projectsBucket, type: 'PLAINTEXT' },
      ],
      sourceTypeOverride: 'S3',
      sourceLocationOverride: `${config.projectsBucket}/${projectId}/generated/`,
    })
  );

  const buildId = buildResult.build?.id;
  if (!buildId) throw new Error('Failed to start CodeBuild');

  log('info', 'CodeBuild started', { projectId, buildId });

  // Poll for completion
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes

  while (attempts < maxAttempts) {
    await sleep(5000);
    attempts++;

    const statusResult = await codebuildClient.send(
      new BatchGetBuildsCommand({ ids: [buildId] })
    );

    const build = statusResult.builds?.[0];
    if (!build) throw new Error('Build not found');

    const phase = build.currentPhase;
    const status = build.buildStatus;

    if (status === 'SUCCEEDED') {
      log('info', 'CodeBuild succeeded', { projectId, buildId });

      // Track cost
      const startTime = build.startTime?.getTime() ?? Date.now();
      const endTime = build.endTime?.getTime() ?? Date.now();
      const durationMinutes = (endTime - startTime) / 60000;
      await costTracker.record(
        projectId,
        'codebuild',
        0,
        0,
        'docker_build',
        { durationMinutes: String(Math.round(durationMinutes)) }
      );

      return imageUri;
    }

    if (status === 'FAILED' || status === 'FAULT' || status === 'STOPPED') {
      const logs = build.logs?.deepLink ?? 'No logs';
      throw new Error(`CodeBuild failed: ${status}. Phase: ${phase}. Logs: ${logs}`);
    }
  }

  throw new Error('CodeBuild timed out');
}

// ---------------------------------------------------------------------------
// App Runner
// ---------------------------------------------------------------------------

async function deployToAppRunner(
  projectId: string,
  imageUri: string
): Promise<{ serviceUrl: string; serviceArn: string }> {
  const config = getConfig();
  const serviceName = `lazarus-${projectId.substring(0, 8)}`;

  // Check for existing service
  const project = await db.get(config.projectsTable, { projectId });
  const existingArn = project?.serviceArn;

  if (existingArn) {
    // Update existing service
    try {
      const updateResult = await appRunnerClient.send(
        new UpdateServiceCommand({
          ServiceArn: existingArn,
          SourceConfiguration: {
            ImageRepository: {
              ImageIdentifier: imageUri,
              ImageConfiguration: {
                Port: '3000',
                RuntimeEnvironmentVariables: {
                  NODE_ENV: 'production',
                  PORT: '3000',
                },
              },
              ImageRepositoryType: 'ECR',
            },
            AuthenticationConfiguration: {
              AccessRoleArn: config.appRunnerAccessRoleArn,
            },
          },
        })
      );

      const serviceUrl = updateResult.Service?.ServiceUrl ?? '';

      // Wait for deployment
      await waitForAppRunner(existingArn);

      return {
        serviceUrl: `https://${serviceUrl}`,
        serviceArn: existingArn,
      };
    } catch (error) {
      log('warn', 'Failed to update App Runner service, creating new', {
        projectId,
        error: String(error),
      });
    }
  }

  // Create new service
  const createResult = await appRunnerClient.send(
    new CreateServiceCommand({
      ServiceName: serviceName,
      SourceConfiguration: {
        ImageRepository: {
          ImageIdentifier: imageUri,
          ImageConfiguration: {
            Port: '3000',
            RuntimeEnvironmentVariables: {
              NODE_ENV: 'production',
              PORT: '3000',
            },
          },
          ImageRepositoryType: 'ECR',
        },
        AuthenticationConfiguration: {
          AccessRoleArn: config.appRunnerAccessRoleArn,
        },
      },
      InstanceConfiguration: {
        Cpu: '1024',
        Memory: '2048',
      },
      HealthCheckConfiguration: {
        Protocol: 'HTTP',
        Path: '/',
        Interval: 10,
        Timeout: 5,
        HealthyThreshold: 1,
        UnhealthyThreshold: 5,
      },
    })
  );

  const serviceArn = createResult.Service?.ServiceArn ?? '';
  const serviceUrl = createResult.Service?.ServiceUrl ?? '';

  log('info', 'App Runner service created', {
    projectId,
    serviceArn,
    serviceUrl,
  });

  // Wait for deployment
  await waitForAppRunner(serviceArn);

  return {
    serviceUrl: `https://${serviceUrl}`,
    serviceArn,
  };
}

async function waitForAppRunner(serviceArn: string): Promise<void> {
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes

  while (attempts < maxAttempts) {
    await sleep(5000);
    attempts++;

    const result = await appRunnerClient.send(
      new DescribeServiceCommand({ ServiceArn: serviceArn })
    );

    const status = result.Service?.Status;

    if (status === 'RUNNING') {
      return;
    }

    if (
      status === 'CREATE_FAILED' ||
      status === 'DELETE_FAILED' ||
      status === 'DELETED'
    ) {
      throw new Error(`App Runner service failed: ${status}`);
    }
  }

  throw new Error('App Runner deployment timed out');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
