// ============================================================================
// LAZARUS — Inspector Stack Detector
// Uses Haiku to detect/confirm tech stack from file analysis results
// ============================================================================

import { bedrock, MODELS } from '../../shared/bedrock';
import { log } from '../../shared/logger';
import type { FileAnalysis, TechStack } from '../../shared/types';

interface StackDetectionResult {
  techStack: TechStack;
  confidence: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Main detection
// ---------------------------------------------------------------------------

export async function detectStack(
  files: FileAnalysis[]
): Promise<StackDetectionResult> {
  // Phase 1: Heuristic detection
  const heuristic = heuristicDetection(files);

  // Phase 2: AI-assisted confirmation via Haiku
  const aiResult = await aiDetection(files, heuristic);

  return aiResult;
}

// ---------------------------------------------------------------------------
// Heuristic-based detection
// ---------------------------------------------------------------------------

function heuristicDetection(files: FileAnalysis[]): Partial<TechStack> {
  const stack: Partial<TechStack> = {
    language: 'unknown',
    framework: 'unknown',
    buildTool: 'unknown',
    runtime: 'unknown',
    styling: 'unknown',
    stateManagement: 'unknown',
    testing: 'unknown',
    packageManager: 'npm',
    database: 'unknown',
    orm: 'unknown',
    apiStyle: null,
    deployment: 'unknown',
    cicd: 'unknown',
    monorepo: false,
    hasTypeScript: false,
    ssr: false,
    pwa: false,
  };

  // Count file types
  const langCounts: Record<string, number> = {};
  for (const file of files) {
    langCounts[file.language] = (langCounts[file.language] ?? 0) + 1;
  }

  // Detect primary language
  const tsCount = (langCounts['typescript'] ?? 0);
  const jsCount = (langCounts['javascript'] ?? 0);
  const pyCount = (langCounts['python'] ?? 0);

  if (tsCount > 0) {
    stack.language = 'TypeScript';
    stack.hasTypeScript = true;
  } else if (jsCount > 0) {
    stack.language = 'JavaScript';
  } else if (pyCount > jsCount && pyCount > tsCount) {
    stack.language = 'Python';
  }

  // Detect from config files and dependencies
  const allDeps = new Set<string>();
  for (const file of files) {
    for (const dep of file.dependencies ?? []) {
      allDeps.add(dep);
    }
  }

  // Find package.json content
  const packageJsonFile = files.find(
    (f) => f.filePath === 'package.json' || f.filePath.endsWith('/package.json')
  );

  // Framework detection
  if (allDeps.has('next') || allDeps.has('next/link') || allDeps.has('next/router') || allDeps.has('next/image')) {
    stack.framework = 'Next.js';
    stack.ssr = true;
    stack.runtime = 'Node.js';
  } else if (allDeps.has('react') || allDeps.has('react-dom')) {
    stack.framework = 'React';
    stack.runtime = 'Node.js';
    // Check for CRA vs Vite
    if (allDeps.has('react-scripts')) {
      stack.buildTool = 'Create React App';
    }
  } else if (allDeps.has('vue') || allDeps.has('vue-router')) {
    stack.framework = 'Vue.js';
    stack.runtime = 'Node.js';
    if (allDeps.has('nuxt') || allDeps.has('nuxt3')) {
      stack.framework = 'Nuxt.js';
      stack.ssr = true;
    }
  } else if (allDeps.has('svelte') || allDeps.has('svelte/store')) {
    stack.framework = 'Svelte';
    stack.runtime = 'Node.js';
    if (allDeps.has('@sveltejs/kit')) {
      stack.framework = 'SvelteKit';
      stack.ssr = true;
    }
  } else if (allDeps.has('angular') || allDeps.has('@angular/core')) {
    stack.framework = 'Angular';
    stack.runtime = 'Node.js';
  } else if (allDeps.has('express')) {
    stack.framework = 'Express';
    stack.runtime = 'Node.js';
  } else if (allDeps.has('fastify')) {
    stack.framework = 'Fastify';
    stack.runtime = 'Node.js';
  } else if (allDeps.has('koa')) {
    stack.framework = 'Koa';
    stack.runtime = 'Node.js';
  } else if (allDeps.has('hono')) {
    stack.framework = 'Hono';
    stack.runtime = 'Node.js';
  } else if (allDeps.has('flask') || allDeps.has('Flask')) {
    stack.framework = 'Flask';
    stack.runtime = 'Python';
  } else if (allDeps.has('django') || allDeps.has('Django')) {
    stack.framework = 'Django';
    stack.runtime = 'Python';
  } else if (allDeps.has('fastapi') || allDeps.has('FastAPI')) {
    stack.framework = 'FastAPI';
    stack.runtime = 'Python';
  }

  // Build tool
  if (allDeps.has('vite') || allDeps.has('@vitejs/plugin-react')) {
    stack.buildTool = 'Vite';
  } else if (allDeps.has('webpack')) {
    stack.buildTool = 'Webpack';
  } else if (allDeps.has('esbuild')) {
    stack.buildTool = 'esbuild';
  } else if (allDeps.has('turbo') || allDeps.has('turbopack')) {
    stack.buildTool = 'Turbopack';
  } else if (allDeps.has('rollup')) {
    stack.buildTool = 'Rollup';
  } else if (allDeps.has('parcel')) {
    stack.buildTool = 'Parcel';
  }

  // Styling
  if (allDeps.has('tailwindcss')) {
    stack.styling = 'Tailwind CSS';
  } else if (allDeps.has('styled-components')) {
    stack.styling = 'styled-components';
  } else if (allDeps.has('@emotion/react') || allDeps.has('@emotion/styled')) {
    stack.styling = 'Emotion';
  } else if (allDeps.has('sass') || allDeps.has('node-sass')) {
    stack.styling = 'SCSS';
  } else if (allDeps.has('@mui/material') || allDeps.has('@material-ui/core')) {
    stack.styling = 'Material UI';
  } else if (allDeps.has('antd')) {
    stack.styling = 'Ant Design';
  } else if (allDeps.has('chakra-ui') || allDeps.has('@chakra-ui/react')) {
    stack.styling = 'Chakra UI';
  }

  // State management
  if (allDeps.has('redux') || allDeps.has('@reduxjs/toolkit')) {
    stack.stateManagement = 'Redux';
  } else if (allDeps.has('zustand')) {
    stack.stateManagement = 'Zustand';
  } else if (allDeps.has('mobx')) {
    stack.stateManagement = 'MobX';
  } else if (allDeps.has('jotai')) {
    stack.stateManagement = 'Jotai';
  } else if (allDeps.has('recoil')) {
    stack.stateManagement = 'Recoil';
  } else if (allDeps.has('pinia')) {
    stack.stateManagement = 'Pinia';
  } else if (allDeps.has('vuex')) {
    stack.stateManagement = 'Vuex';
  }

  // Testing
  if (allDeps.has('jest')) {
    stack.testing = 'Jest';
  } else if (allDeps.has('vitest')) {
    stack.testing = 'Vitest';
  } else if (allDeps.has('mocha')) {
    stack.testing = 'Mocha';
  } else if (allDeps.has('cypress')) {
    stack.testing = 'Cypress';
  } else if (allDeps.has('@playwright/test')) {
    stack.testing = 'Playwright';
  } else if (allDeps.has('pytest')) {
    stack.testing = 'pytest';
  }

  // Package manager detection
  const hasYarnLock = files.some((f) => f.filePath.endsWith('yarn.lock'));
  const hasPnpmLock = files.some((f) => f.filePath.endsWith('pnpm-lock.yaml'));
  const hasBunLock = files.some((f) => f.filePath.endsWith('bun.lockb'));
  const hasPackageLock = files.some((f) => f.filePath.endsWith('package-lock.json'));

  if (hasPnpmLock) stack.packageManager = 'pnpm';
  else if (hasYarnLock) stack.packageManager = 'yarn';
  else if (hasBunLock) stack.packageManager = 'bun';
  else if (hasPackageLock) stack.packageManager = 'npm';

  // Database & ORM
  if (allDeps.has('prisma') || allDeps.has('@prisma/client')) {
    stack.orm = 'Prisma';
    stack.database = 'PostgreSQL'; // default assumption
  } else if (allDeps.has('drizzle-orm')) {
    stack.orm = 'Drizzle';
  } else if (allDeps.has('typeorm')) {
    stack.orm = 'TypeORM';
  } else if (allDeps.has('sequelize')) {
    stack.orm = 'Sequelize';
  } else if (allDeps.has('mongoose')) {
    stack.orm = 'Mongoose';
    stack.database = 'MongoDB';
  } else if (allDeps.has('knex')) {
    stack.orm = 'Knex';
  }

  if (allDeps.has('pg') || allDeps.has('postgres')) {
    stack.database = 'PostgreSQL';
  } else if (allDeps.has('mysql2') || allDeps.has('mysql')) {
    stack.database = 'MySQL';
  } else if (allDeps.has('mongodb')) {
    stack.database = 'MongoDB';
  } else if (allDeps.has('redis') || allDeps.has('ioredis')) {
    if (stack.database === 'unknown') stack.database = 'Redis';
  }

  // API style
  if (allDeps.has('graphql') || allDeps.has('@apollo/server') || allDeps.has('apollo-server')) {
    stack.apiStyle = 'GraphQL';
  } else if (allDeps.has('trpc') || allDeps.has('@trpc/server')) {
    stack.apiStyle = 'tRPC';
  } else {
    stack.apiStyle = 'REST';
  }

  // Monorepo
  const hasWorkspaces = files.some((f) =>
    f.filePath === 'lerna.json' ||
    f.filePath === 'pnpm-workspace.yaml' ||
    f.filePath === 'nx.json' ||
    f.filePath === 'turbo.json'
  );
  stack.monorepo = hasWorkspaces;

  return stack;
}

// ---------------------------------------------------------------------------
// AI-assisted detection via Haiku
// ---------------------------------------------------------------------------

async function aiDetection(
  files: FileAnalysis[],
  heuristic: Partial<TechStack>
): Promise<StackDetectionResult> {
  // Build a compact summary for Claude
  const summary = buildFileSummary(files);

  const prompt = `Analyze this codebase and confirm/correct the detected tech stack.

HEURISTIC DETECTION (may be incomplete or wrong):
${JSON.stringify(heuristic, null, 2)}

FILE SUMMARY:
${summary}

Respond with a JSON object containing exactly these fields:
{
  "techStack": {
    "language": "string",
    "framework": "string",
    "buildTool": "string",
    "runtime": "string",
    "styling": "string",
    "stateManagement": "string",
    "testing": "string",
    "packageManager": "string",
    "database": "string",
    "orm": "string",
    "apiStyle": "string",
    "deployment": "string",
    "cicd": "string",
    "monorepo": boolean,
    "typescript": boolean,
    "ssr": boolean,
    "pwa": boolean
  },
  "confidence": number (0-1),
  "reasoning": "string explaining detection"
}

For unknown/undetected items, use "none" instead of "unknown".
Be precise. Only report what you can confirm from the file analysis.`;

  try {
    const payload = bedrock.buildHaikuPayload(prompt, 2000);
    const response = await bedrock.invoke(payload, MODELS.HAIKU);

    const parsed = JSON.parse(
      typeof response === 'string' ? response : response.content
    ) as StackDetectionResult;

    // Validate and clean up
    const result: StackDetectionResult = {
      techStack: {
        language: parsed.techStack?.language ?? heuristic.language ?? 'unknown',
        languageVersion: '',
        framework: parsed.techStack?.framework ?? heuristic.framework ?? 'unknown',
        frameworkVersion: '',
        targetFramework: '',
        targetFrameworkVersion: '',
        buildTool: parsed.techStack?.buildTool ?? heuristic.buildTool ?? 'unknown',
        runtime: parsed.techStack?.runtime ?? heuristic.runtime ?? 'unknown',
        styling: parsed.techStack?.styling ?? heuristic.styling ?? 'unknown',
        stateManagement: parsed.techStack?.stateManagement ?? heuristic.stateManagement ?? null,
        testFramework: parsed.techStack?.testing ?? heuristic.testing ?? null,
        cssFramework: parsed.techStack?.styling ?? heuristic.styling ?? null,
        router: null,
        testing: parsed.techStack?.testing ?? heuristic.testing ?? 'unknown',
        packageManager: parsed.techStack?.packageManager ?? heuristic.packageManager ?? 'npm',
        database: parsed.techStack?.database ?? heuristic.database ?? null,
        orm: parsed.techStack?.orm ?? heuristic.orm ?? null,
        apiStyle: parsed.techStack?.apiStyle ?? heuristic.apiStyle ?? null,
        containerized: false,
        deployment: parsed.techStack?.deployment ?? heuristic.deployment ?? 'unknown',
        cicd: parsed.techStack?.cicd ?? heuristic.cicd ?? 'unknown',
        monorepo: parsed.techStack?.monorepo ?? heuristic.monorepo ?? false,
        hasTypeScript: parsed.techStack?.hasTypeScript ?? heuristic.hasTypeScript ?? false,
        hasDocker: false,
        hasCICD: false,
        entryPoint: '',
        sourceDirectory: '',
        outputDirectory: '',
        port: 0,
        ssr: parsed.techStack?.ssr ?? heuristic.ssr ?? false,
        pwa: parsed.techStack?.pwa ?? heuristic.pwa ?? false,
      },
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      reasoning: parsed.reasoning ?? 'AI detection completed',
    };

    return result;
  } catch (error) {
    log('warn', 'AI stack detection failed, using heuristics', {
      error: String(error),
    });

    // Fallback to heuristic results
    return {
      techStack: {
        language: heuristic.language ?? 'unknown',
        languageVersion: '',
        framework: heuristic.framework ?? 'unknown',
        frameworkVersion: '',
        targetFramework: '',
        targetFrameworkVersion: '',
        buildTool: heuristic.buildTool ?? 'unknown',
        runtime: heuristic.runtime ?? 'unknown',
        styling: heuristic.styling ?? 'unknown',
        stateManagement: heuristic.stateManagement ?? null,
        testFramework: heuristic.testing ?? null,
        cssFramework: heuristic.styling ?? null,
        router: null,
        testing: heuristic.testing ?? 'unknown',
        packageManager: heuristic.packageManager ?? 'npm',
        database: heuristic.database ?? null,
        orm: heuristic.orm ?? null,
        apiStyle: heuristic.apiStyle ?? null,
        containerized: false,
        deployment: heuristic.deployment ?? 'unknown',
        cicd: heuristic.cicd ?? 'unknown',
        monorepo: heuristic.monorepo ?? false,
        hasTypeScript: heuristic.hasTypeScript ?? false,
        hasDocker: false,
        hasCICD: false,
        entryPoint: '',
        sourceDirectory: '',
        outputDirectory: '',
        port: 0,
        ssr: heuristic.ssr ?? false,
        pwa: heuristic.pwa ?? false,
      },
      confidence: 0.5,
      reasoning: 'Heuristic-only detection (AI confirmation unavailable)',
    };
  }
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildFileSummary(files: FileAnalysis[]): string {
  const lines: string[] = [];

  // File type counts
  const langCounts: Record<string, number> = {};
  for (const f of files) {
    langCounts[f.language] = (langCounts[f.language] ?? 0) + 1;
  }
  lines.push(`File types: ${JSON.stringify(langCounts)}`);
  lines.push(`Total files: ${files.length}`);
  lines.push(`Total lines: ${files.reduce((s, f) => s + f.lineCount, 0)}`);

  // Config files
  const configs = files.filter((f) => f.isConfig).map((f) => f.filePath);
  if (configs.length > 0) {
    lines.push(`Config files: ${configs.slice(0, 20).join(', ')}`);
  }

  // Entry points
  const entries = files.filter((f) => f.isEntryPoint).map((f) => f.filePath);
  if (entries.length > 0) {
    lines.push(`Entry points: ${entries.slice(0, 10).join(', ')}`);
  }

  // All unique dependencies (external)
  const allDeps = new Set<string>();
  for (const f of files) {
    for (const d of f.dependencies ?? []) {
      allDeps.add(d);
    }
  }
  const depsList = Array.from(allDeps).sort();
  lines.push(`External dependencies (${depsList.length}): ${depsList.slice(0, 100).join(', ')}`);

  // JSX presence
  const jsxFiles = files.filter((f) => f.hasJSX).length;
  if (jsxFiles > 0) {
    lines.push(`JSX files: ${jsxFiles}`);
  }

  // Test files
  const testCount = files.filter((f) => f.isTest).length;
  if (testCount > 0) {
    lines.push(`Test files: ${testCount}`);
  }

  // Classes
  const allClasses = files.flatMap((f) => f.classes as string[]);
  if (allClasses.length > 0) {
    lines.push(`Classes: ${allClasses.slice(0, 30).join(', ')}`);
  }

  // Top-level directory structure
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.filePath.split('/');
    if (parts.length > 1) {
      dirs.add(parts[0] + '/');
    }
  }
  lines.push(`Top directories: ${Array.from(dirs).sort().join(', ')}`);

  return lines.join('\n');
}
