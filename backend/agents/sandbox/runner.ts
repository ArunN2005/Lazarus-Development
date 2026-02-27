// ============================================================================
// LAZARUS — Sandbox Runner
// Runs inside ECS Fargate container: install → build → start → healthcheck
// ============================================================================

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

const PROJECT_ID = process.env.PROJECT_ID!;
const ITERATION = parseInt(process.env.ITERATION ?? '1', 10);
const S3_BUCKET = process.env.S3_BUCKET!;
const REGION = process.env.AWS_REGION ?? 'ap-south-1';

const s3 = new S3Client({ region: REGION });
const WORK_DIR = '/app/project';
const LOG_FILE = '/app/logs.txt';
const logs: string[] = [];

function logMsg(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  logs.push(line);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let exitCode = 0;

  try {
    logMsg(`Sandbox runner starting: project=${PROJECT_ID}, iteration=${ITERATION}`);

    // 1. Download generated code from S3
    await downloadProject();

    // 2. Install dependencies
    logMsg('=== INSTALL PHASE ===');
    const installResult = await runInstall();
    if (!installResult) {
      logMsg('INSTALL FAILED');
      exitCode = 1;
      await uploadLogs();
      process.exit(exitCode);
    }
    logMsg('Install succeeded');

    // 3. Build
    logMsg('=== BUILD PHASE ===');
    const buildResult = await runBuild();
    if (!buildResult) {
      logMsg('BUILD FAILED');
      exitCode = 2;
      await uploadLogs();
      process.exit(exitCode);
    }
    logMsg('Build succeeded');

    // 4. Start server
    logMsg('=== START PHASE ===');
    const serverProcess = await startServer();
    if (!serverProcess) {
      logMsg('START FAILED');
      exitCode = 3;
      await uploadLogs();
      process.exit(exitCode);
    }
    logMsg('Server started');

    // 5. Health check
    logMsg('=== HEALTH CHECK PHASE ===');
    const healthy = await healthCheck();
    if (!healthy) {
      logMsg('HEALTH CHECK FAILED');
      exitCode = 4;
    } else {
      logMsg('HEALTH CHECK PASSED');
      exitCode = 0;
    }

    // Kill server
    serverProcess.kill('SIGTERM');
  } catch (error) {
    logMsg(`FATAL ERROR: ${String(error)}`);
    exitCode = 99;
  }

  await uploadLogs();
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Download project from S3
// ---------------------------------------------------------------------------

async function downloadProject(): Promise<void> {
  logMsg('Downloading generated code from S3...');

  // Create work directory
  fs.mkdirSync(WORK_DIR, { recursive: true });

  // List all generated files
  const prefix = `${PROJECT_ID}/generated/`;
  let continuationToken: string | undefined;
  const keys: string[] = [];

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  logMsg(`Found ${keys.length} generated files`);

  // Download each file
  for (const key of keys) {
    const relativePath = key.substring(prefix.length);
    if (!relativePath) continue;

    const localPath = path.join(WORK_DIR, relativePath);
    const localDir = path.dirname(localPath);
    fs.mkdirSync(localDir, { recursive: true });

    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
        })
      );

      const body = response.Body;
      if (body instanceof Readable) {
        const chunks: Buffer[] = [];
        for await (const chunk of body) {
          chunks.push(Buffer.from(chunk));
        }
        fs.writeFileSync(localPath, Buffer.concat(chunks));
      }
    } catch (error) {
      logMsg(`Failed to download ${key}: ${String(error)}`);
    }
  }

  logMsg('Project downloaded successfully');
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

async function runInstall(): Promise<boolean> {
  try {
    // Detect package manager
    const hasYarnLock = fs.existsSync(path.join(WORK_DIR, 'yarn.lock'));
    const hasPnpmLock = fs.existsSync(path.join(WORK_DIR, 'pnpm-lock.yaml'));
    const hasPackageLock = fs.existsSync(path.join(WORK_DIR, 'package-lock.json'));

    let installCmd: string;
    if (hasPnpmLock) {
      installCmd = 'pnpm install --no-frozen-lockfile';
    } else if (hasYarnLock) {
      installCmd = 'yarn install --no-immutable';
    } else {
      installCmd = 'npm install --legacy-peer-deps';
    }

    // Check if package.json exists
    const pkgPath = path.join(WORK_DIR, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      logMsg('No package.json found — skipping install');
      return true;
    }

    logMsg(`Running: ${installCmd}`);
    const output = execSync(installCmd, {
      cwd: WORK_DIR,
      timeout: 120_000,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, CI: 'true', NODE_ENV: 'development' },
    });

    logMsg(output.substring(0, 5000));
    return true;
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    logMsg(`Install error: ${err.stderr ?? err.stdout ?? String(error)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function runBuild(): Promise<boolean> {
  try {
    const pkgPath = path.join(WORK_DIR, 'package.json');
    if (!fs.existsSync(pkgPath)) return true;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts ?? {};

    // Find build command
    let buildCmd: string | null = null;
    if (scripts.build) {
      buildCmd = 'npm run build';
    } else if (scripts['build:prod']) {
      buildCmd = 'npm run build:prod';
    } else if (scripts.compile) {
      buildCmd = 'npm run compile';
    } else if (scripts.tsc) {
      buildCmd = 'npm run tsc';
    }

    if (!buildCmd) {
      logMsg('No build script found — skipping build');
      return true;
    }

    logMsg(`Running: ${buildCmd}`);
    const output = execSync(buildCmd, {
      cwd: WORK_DIR,
      timeout: 180_000,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        CI: 'true',
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    });

    logMsg(output.substring(0, 5000));
    return true;
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string };
    logMsg(`Build error: ${err.stderr ?? err.stdout ?? String(error)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function startServer(): Promise<ChildProcess | null> {
  try {
    const pkgPath = path.join(WORK_DIR, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts ?? {};

    // Find start command
    let startCmd: string;
    let startArgs: string[];

    if (scripts.start) {
      startCmd = 'npm';
      startArgs = ['run', 'start'];
    } else if (scripts.dev) {
      startCmd = 'npm';
      startArgs = ['run', 'dev'];
    } else if (scripts.serve) {
      startCmd = 'npm';
      startArgs = ['run', 'serve'];
    } else if (scripts.preview) {
      startCmd = 'npm';
      startArgs = ['run', 'preview'];
    } else {
      // Try to find a main file
      const mainFile = pkg.main ?? 'index.js';
      if (fs.existsSync(path.join(WORK_DIR, mainFile))) {
        startCmd = 'node';
        startArgs = [mainFile];
      } else {
        logMsg('No start command or main file found');
        return null;
      }
    }

    logMsg(`Starting: ${startCmd} ${startArgs.join(' ')}`);

    const child = spawn(startCmd, startArgs, {
      cwd: WORK_DIR,
      env: {
        ...process.env,
        PORT: '3000',
        HOST: '0.0.0.0',
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
    });

    // Capture output
    child.stdout?.on('data', (data) => {
      logMsg(`[stdout] ${String(data).trim()}`);
    });

    child.stderr?.on('data', (data) => {
      logMsg(`[stderr] ${String(data).trim()}`);
    });

    // Wait for server to be ready
    await sleep(8000);

    if (child.exitCode !== null) {
      logMsg(`Server exited with code ${child.exitCode}`);
      return null;
    }

    return child;
  } catch (error) {
    logMsg(`Start error: ${String(error)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function healthCheck(): Promise<boolean> {
  const maxAttempts = 10;
  const delay = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logMsg(`Health check attempt ${attempt}/${maxAttempts}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('http://localhost:3000', {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      logMsg(`Health check response: ${response.status}`);

      if (response.status >= 200 && response.status < 500) {
        // 2xx-4xx means the server is running (4xx might be auth required)
        return true;
      }
    } catch (error) {
      logMsg(`Health check attempt ${attempt} failed: ${String(error)}`);
    }

    if (attempt < maxAttempts) {
      await sleep(delay);
    }
  }

  // Also try common API endpoints
  const endpoints = ['/api/health', '/health', '/api', '/ping'];
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://localhost:3000${endpoint}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status >= 200 && response.status < 500) {
        logMsg(`Health check passed on ${endpoint}: ${response.status}`);
        return true;
      }
    } catch {
      // Continue to next endpoint
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Upload logs
// ---------------------------------------------------------------------------

async function uploadLogs(): Promise<void> {
  try {
    const logContent = logs.join('\n');

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `${PROJECT_ID}/sandbox/iteration-${ITERATION}/logs.txt`,
        Body: logContent,
        ContentType: 'text/plain',
      })
    );
  } catch (error) {
    console.error(`Failed to upload logs: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run
main().catch((error) => {
  console.error('Fatal error in sandbox runner:', error);
  process.exit(99);
});
