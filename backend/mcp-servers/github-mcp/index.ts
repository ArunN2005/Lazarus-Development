// ============================================================================
// LAZARUS — GitHub MCP Server
// ECS Fargate container: clones repo, uploads to S3, exits
// ============================================================================

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ID = process.env['PROJECT_ID'] ?? '';
const GITHUB_URL = process.env['GITHUB_URL'] ?? '';
const S3_BUCKET = process.env['S3_BUCKET'] ?? '';
const PAT = process.env['GITHUB_PAT'] ?? '';
const REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

const s3 = new S3Client({ region: REGION, maxAttempts: 3 });

// ---------------------------------------------------------------------------
// Binary file extensions — skip parsing, upload to assets/
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.mp3', '.wav', '.ogg', '.avi', '.mov',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.pyc', '.pyo',
  '.db', '.sqlite', '.sqlite3',
  '.DS_Store',
]);

// ---------------------------------------------------------------------------
// Directories to skip
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '__pycache__',
  'coverage', '.turbo', 'out', 'vendor', '.venv', 'venv',
  '.idea', '.vscode', '.cache', '.parcel-cache', '.nuxt',
  'target', 'bin', 'obj', '.gradle',
]);

// ---------------------------------------------------------------------------
// Sparse checkout paths for large repos
// ---------------------------------------------------------------------------

const SPARSE_PATHS = [
  'src/', 'app/', 'lib/', 'components/', 'api/', 'routes/',
  'models/', 'pages/', 'server/', 'backend/', 'frontend/',
  'views/', 'templates/', 'public/', 'static/', 'config/',
  'package.json', 'tsconfig.json', 'requirements.txt',
  'Dockerfile', 'docker-compose.yml', '.env.example',
  'next.config.js', 'next.config.ts', 'vite.config.ts',
  'webpack.config.js', 'angular.json', 'vue.config.js',
  'Makefile', 'Gemfile', 'pom.xml', 'build.gradle',
];

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MAX_TEXT_FILES = 1000;

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(JSON.stringify({
    level: 'info',
    message: 'GitHub MCP starting',
    projectId: PROJECT_ID,
    githubUrl: GITHUB_URL,
  }));

  if (!PROJECT_ID || !GITHUB_URL || !S3_BUCKET) {
    console.error('Missing required env vars: PROJECT_ID, GITHUB_URL, S3_BUCKET');
    process.exit(1);
  }

  const cloneDir = `/tmp/${PROJECT_ID}`;

  try {
    // 1. Setup git credential helper for PAT auth
    if (PAT) {
      setupCredentials(PAT);
    }

    // 2. Clone
    await cloneRepo(GITHUB_URL, cloneDir);

    // 3. Walk directory and upload
    const { textFiles, binaryFiles, fileList } = await walkAndUpload(cloneDir);

    // 4. Check if we need sparse checkout
    if (textFiles > MAX_TEXT_FILES) {
      console.log(JSON.stringify({
        level: 'warn',
        message: 'Large repo detected, would use sparse checkout',
        textFiles,
      }));

      // Write warning
      await uploadToS3(
        `${PROJECT_ID}/original/_lazarus_sparse_warning.json`,
        JSON.stringify({
          message: `Repo has ${textFiles} text files (limit: ${MAX_TEXT_FILES})`,
          sparsePathsUsed: SPARSE_PATHS,
          timestamp: new Date().toISOString(),
        }),
        'application/json'
      );
    }

    // 5. Write manifest
    const manifest = {
      totalFiles: textFiles + binaryFiles,
      textFiles,
      binaryFiles,
      fileList,
      timestamp: new Date().toISOString(),
      sparseCheckout: false,
      warnings: [] as string[],
    };

    await uploadToS3(
      `${PROJECT_ID}/original/_lazarus_manifest.json`,
      JSON.stringify(manifest, null, 2),
      'application/json'
    );

    console.log(JSON.stringify({
      level: 'info',
      message: 'GitHub MCP complete',
      projectId: PROJECT_ID,
      textFiles,
      binaryFiles,
      totalFiles: textFiles + binaryFiles,
    }));

    process.exit(0);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'GitHub MCP failed',
      projectId: PROJECT_ID,
      error: String(error),
    }));
    process.exit(1);
  } finally {
    // Cleanup
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Git operations
// ---------------------------------------------------------------------------

function setupCredentials(pat: string): void {
  // Use credential helper that returns PAT
  const credHelper = `#!/bin/sh\necho "protocol=https\nhost=github.com\nusername=x-access-token\npassword=${pat}"`;
  const helperPath = '/tmp/git-credentials-helper.sh';
  fs.writeFileSync(helperPath, credHelper, { mode: 0o755 });

  execSync(`git config --global credential.helper '${helperPath}'`, {
    stdio: 'pipe',
  });
}

async function cloneRepo(url: string, targetDir: string): Promise<void> {
  // Sanitize URL to prevent command injection
  const sanitizedUrl = sanitizeGitUrl(url);

  // Remove existing dir if present
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Cloning repository',
    url: sanitizedUrl,
  }));

  const result = spawnSync('git', ['clone', '--depth=1', sanitizedUrl, targetDir], {
    timeout: 300_000, // 5 minutes
    stdio: 'pipe',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? 'Unknown error';
    throw new Error(`git clone failed: ${stderr}`);
  }

  console.log(JSON.stringify({
    level: 'info',
    message: 'Clone complete',
  }));
}

function sanitizeGitUrl(url: string): string {
  // Only allow valid GitHub URLs
  const githubPattern = /^https?:\/\/(www\.)?github\.com\/[\w\-._]+\/[\w\-._]+(\.git)?$/;
  if (!githubPattern.test(url)) {
    throw new Error(`Invalid GitHub URL: ${url}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// File walking and uploading
// ---------------------------------------------------------------------------

async function walkAndUpload(
  rootDir: string
): Promise<{ textFiles: number; binaryFiles: number; fileList: string[] }> {
  let textFiles = 0;
  let binaryFiles = 0;
  const fileList: string[] = [];

  async function walkDir(dirPath: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        // Check file size
        let stats: fs.Stats;
        try {
          stats = fs.statSync(fullPath);
        } catch {
          continue;
        }

        if (isBinaryFile(ext, fullPath)) {
          // Upload binary to assets/
          const buffer = fs.readFileSync(fullPath);
          await uploadToS3(
            `${PROJECT_ID}/assets/${relativePath}`,
            buffer,
            getContentType(ext)
          );
          binaryFiles++;
        } else {
          // Text file
          if (stats.size > MAX_FILE_SIZE) {
            console.log(JSON.stringify({
              level: 'warn',
              message: 'Large file detected, uploading as-is',
              file: relativePath,
              sizeKB: Math.round(stats.size / 1024),
            }));
          }

          const content = fs.readFileSync(fullPath, 'utf-8');
          await uploadToS3(
            `${PROJECT_ID}/original/${relativePath}`,
            content,
            getContentType(ext)
          );
          textFiles++;
          fileList.push(relativePath);
        }
      }
    }
  }

  await walkDir(rootDir);
  return { textFiles, binaryFiles, fileList };
}

function isBinaryFile(ext: string, filePath: string): boolean {
  if (BINARY_EXTENSIONS.has(ext)) return true;

  // Check magic bytes for unknown extensions
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);

    // Check for null bytes (strong binary indicator)
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
  } catch {
    // If we can't read it, assume text
  }

  return false;
}

// ---------------------------------------------------------------------------
// S3 upload
// ---------------------------------------------------------------------------

async function uploadToS3(
  key: string,
  content: string | Buffer,
  contentType: string
): Promise<void> {
  const body = typeof content === 'string' ? content : content;

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.jsx': 'application/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.py': 'text/x-python',
    '.java': 'text/x-java-source',
    '.rb': 'text/x-ruby',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return types[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
