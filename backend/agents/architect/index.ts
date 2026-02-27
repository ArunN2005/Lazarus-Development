// ============================================================================
// LAZARUS — Architect Agent (Agent 2)
// Generates a comprehensive migration plan using Claude Sonnet with caching
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { bedrock, MODELS } from '../../shared/bedrock';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type ProjectAnalysis,
  type MigrationPlan,
  type MigrationPlanFile,
  type TechStack,
  type FileAnalysis,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event: ProjectAnalysis & { envVarsRequired?: boolean }): Promise<{ projectId: string; planVersion: number; plan: MigrationPlan }> {
  const config = getConfig();
  // Step Functions passes the Inspector's ProjectAnalysis output directly as the event object.
  // The analysis IS the event — it is not nested under an 'analysis' key.
  const analysis = event;
  const { projectId } = analysis;

  log('info', 'Architect Agent starting', {
    projectId,
    framework: analysis.techStack.framework,
    totalFiles: analysis.totalFiles,
  });

  try {
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.PLANNING,
      currentPhase: PhaseNumber.ARCHITECT,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.ARCHITECT,
        phaseName: 'Architect',
        message: 'Generating migration plan...',
      })
    );

    // 1. Generate migration plan via Claude Sonnet
    const plan = await generateMigrationPlan(projectId, analysis);

    // 2. Validate plan
    validatePlan(plan, analysis);

    // 3. Sort files in dependency order
    const sortedFiles = topologicalSort(plan.files, analysis.dependencyGraph);
    plan.files = sortedFiles;

    // 4. Store plan in DynamoDB and S3
    const planVersion = 1;
    const planId = uuidv4();

    await db.put(config.migrationPlansTable, {
      projectId,
      planId,
      version: planVersion,
      plan,
      totalFiles: plan.files.length,
      estimatedTokens: plan.estimatedTotalTokens,
      estimatedCost: plan.estimatedCost,
      approved: false,
      approvedAt: null,
    });

    // Also store full plan as JSON in S3
    await s3.uploadText(
      config.projectsBucket,
      `${projectId}/plans/v${planVersion}.json`,
      JSON.stringify(plan, null, 2)
    );

    // 5. Update project
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.AWAITING_APPROVAL,
      migrationPlanVersion: planVersion,
      totalFilesToGenerate: plan.files.length,
    });

    // 6. Send plan to frontend via WebSocket
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PLAN_READY, projectId, {
        planVersion,
        totalFiles: plan.files.length,
        estimatedTokens: plan.estimatedTotalTokens,
        estimatedCost: plan.estimatedCost,
        phases: plan.phases,
        summary: plan.summary,
      })
    );

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.ARCHITECT,
        phaseName: 'Architect',
        message: 'Migration plan ready for review.',
      })
    );

    return { projectId, planVersion, plan };
  } catch (error) {
    log('error', 'Architect Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: `Architect: ${String(error)}`,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.ARCHITECT,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Migration plan generation
// ---------------------------------------------------------------------------

async function generateMigrationPlan(
  projectId: string,
  analysis: ProjectAnalysis
): Promise<MigrationPlan> {
  const config = getConfig();

  // Build compact file manifest for prompt
  const fileManifest = buildFileManifest(analysis.files);

  // Build dependency info
  const depInfo = buildDependencyInfo(analysis);

  // Build env var info
  const envInfo = analysis.envVars.length > 0
    ? `\nENVIRONMENT VARIABLES:\n${analysis.envVars.map((v) => `- ${v.name}: ${v.classification} (${v.description})`).join('\n')}`
    : '';

  const systemPrompt = `You are Lazarus Architect, an expert software migration planner. You analyze legacy codebases and produce detailed, file-by-file migration plans. Your plans must be comprehensive, accounting for every file that needs to be created or modified.

KEY PRINCIPLES:
1. Maintain functional parity — the migrated app must do everything the original does
2. Modernize thoughtfully — use current best practices but don't over-engineer
3. Handle dependencies correctly — generate shared utilities first, then consumers
4. Preserve tests — migrate test files alongside source files
5. Config files must be complete and correct
6. Every import must resolve to an existing or planned file`;

  const userPrompt = `Generate a complete migration plan for this codebase.

PROJECT: ${analysis.repoName} (${analysis.githubUrl})
TECH STACK: ${JSON.stringify(analysis.techStack, null, 2)}

FILE MANIFEST (${analysis.files.length} files):
${fileManifest}

DEPENDENCY GRAPH:
${depInfo}
${envInfo}

CIRCULAR DEPENDENCIES: ${analysis.circularDependencies.length > 0
  ? analysis.circularDependencies.map((c) => c.join(' → ')).join('\n')
  : 'None detected'}

ENTRY POINTS: ${analysis.entryPoints.join(', ')}
CONFIG FILES: ${analysis.configFiles.join(', ')}
TEST FILES: ${analysis.testFiles.length} test files

Respond with a JSON migration plan:
{
  "summary": "Brief description of the migration",
  "sourceStack": { /* current tech stack */ },
  "targetStack": { /* target modern tech stack */ },
  "phases": [
    {
      "phase": 1,
      "name": "Phase name",
      "description": "What this phase accomplishes",
      "fileCount": number
    }
  ],
  "files": [
    {
      "sourcePath": "original/path/to/file.js",
      "targetPath": "new/path/to/file.ts",
      "action": "MIGRATE|CREATE|DELETE|RENAME|COPY",
      "phase": 1,
      "priority": 1,
      "description": "What changes to make",
      "dependencies": ["paths this file depends on"],
      "estimatedTokens": number,
      "migrationNotes": "Specific instructions for the Builder agent",
      "isConfig": boolean,
      "isEntryPoint": boolean,
      "isTest": boolean,
      "complexity": "LOW|MEDIUM|HIGH"
    }
  ],
  "estimatedTotalTokens": number,
  "estimatedCost": number,
  "risks": ["potential risks"],
  "recommendations": ["migration recommendations"]
}

IMPORTANT:
- Every original file must be accounted for (migrated, copied, or deleted with reason)
- New config files (tsconfig, package.json, etc.) should be CREATE actions
- Dependencies array must only reference targetPath values from other files in the plan
- Phase 1 = config/setup, Phase 2 = shared utilities, Phase 3 = core logic, Phase 4 = UI/pages, Phase 5 = tests
- Priority within each phase (1 = first, higher = later)
- estimatedTokens per file: config ~500, utility ~1500, component ~2000, page ~3000, complex ~5000`;

  // Use prompt caching for the system prompt (reusable across projects)
  const payload = bedrock.buildSonnetPayload(systemPrompt, userPrompt, 16000);
  const response = await bedrock.invoke(payload, MODELS.SONNET);

  // Track cost
  const inputTokens = systemPrompt.length / 4 + userPrompt.length / 4;
  const outputTokens = response.content.length / 4;
  await costTracker.recordWithCache(
    projectId,
    'bedrock_sonnet',
    Math.round(inputTokens),
    Math.round(outputTokens),
    response.cacheReadTokens ?? 0,
    response.cacheWriteTokens ?? 0,
    'architect_plan'
  );

  // Parse response
  const plan = parseJsonFromResponse<MigrationPlan>(
    response.content
  );

  if (!plan || !plan.files || plan.files.length === 0) {
    throw new Error('Failed to generate valid migration plan');
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validatePlan(plan: MigrationPlan, analysis: ProjectAnalysis): void {
  // Check all original files are accounted for
  const sourcePaths = new Set(plan.files.map((f) => f.sourcePath).filter(Boolean));
  const targetPaths = new Set(plan.files.map((f) => f.targetPath));

  // Validate dependencies reference existing target paths or external modules
  for (const file of plan.files) {
    for (const dep of file.dependencies ?? []) {
      if (dep.startsWith('.') || dep.startsWith('/')) {
        // Internal dependency - should exist in plan
        if (!targetPaths.has(dep)) {
          log('warn', 'Plan references missing dependency', {
            file: file.targetPath,
            missingDep: dep,
          });
        }
      }
    }
  }

  // Validate phases are sequential
  const phases = new Set(plan.files.map((f) => f.phase ?? f.batch));
  const phaseValues = [...phases].filter((v): v is number => v !== undefined);
  const maxPhase = phaseValues.length > 0 ? Math.max(...phaseValues) : 1;
  for (let i = 1; i <= maxPhase; i++) {
    if (!phases.has(i)) {
      log('warn', 'Gap in phase numbering', { missingPhase: i });
    }
  }

  // Warn on high estimated cost
  if (plan.estimatedCost > 10) {
    log('warn', 'High estimated cost', {
      estimatedCost: plan.estimatedCost,
      totalFiles: plan.files.length,
    });
  }

  log('info', 'Plan validation complete', {
    totalFiles: plan.files.length,
    phases: phases.size,
    estimatedCost: plan.estimatedCost,
  });
}

// ---------------------------------------------------------------------------
// Topological sort for dependency ordering
// ---------------------------------------------------------------------------

function topologicalSort(
  files: MigrationPlanFile[],
  dependencyGraph: Record<string, string[]>
): MigrationPlanFile[] {
  const fileMap = new Map(files.map((f) => [f.targetPath, f]));
  const visited = new Set<string>();
  const sorted: MigrationPlanFile[] = [];
  const visiting = new Set<string>();

  function visit(path: string): void {
    if (visited.has(path)) return;
    if (visiting.has(path)) return; // Skip circular

    visiting.add(path);

    const file = fileMap.get(path);
    if (file) {
      for (const dep of file.dependencies ?? []) {
        if (fileMap.has(dep)) {
          visit(dep);
        }
      }
    }

    visiting.delete(path);
    visited.add(path);
    if (file) sorted.push(file);
  }

  // Sort by phase first, then by priority within phase
  const byPhaseAndPriority = [...files].sort(
    (a, b) => (a.phase ?? 0) - (b.phase ?? 0) || a.priority - b.priority
  );

  for (const file of byPhaseAndPriority) {
    visit(file.targetPath ?? file.filePath);
  }

  // Add any files that weren't in the dependency graph
  for (const file of files) {
    if (!visited.has(file.targetPath ?? file.filePath)) {
      sorted.push(file);
    }
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFileManifest(files: FileAnalysis[]): string {
  const lines: string[] = [];

  for (const file of files) {
    const info = [
      file.filePath,
      `${file.language}`,
      `${file.lineCount}L`,
      file.isEntryPoint ? 'ENTRY' : '',
      file.isConfig ? 'CONFIG' : '',
      file.isTest ? 'TEST' : '',
      file.hasJSX ? 'JSX' : '',
      `imports:${file.imports.length}`,
      `exports:${file.exports.length}`,
      `fns:${file.functions.length}`,
      file.classes.length > 0 ? `classes:${file.classes.join(',')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    lines.push(`  ${info}`);
  }

  return lines.join('\n');
}

function buildDependencyInfo(analysis: ProjectAnalysis): string {
  const entries = Object.entries(analysis.dependencyGraph);
  if (entries.length === 0) return 'No internal dependencies detected';

  const lines: string[] = [];
  for (const [file, deps] of entries) {
    if (deps.length > 0) {
      lines.push(`  ${file} → ${deps.join(', ')}`);
    }
  }

  return lines.length > 0
    ? lines.slice(0, 50).join('\n') + (lines.length > 50 ? `\n  ... and ${lines.length - 50} more` : '')
    : 'No internal dependencies detected';
}

function parseJsonFromResponse<T>(response: string): T {
  // Try to extract JSON from the response
  // Claude sometimes wraps JSON in markdown code blocks
  let jsonStr = response;

  // Remove markdown code blocks
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Try to find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  return JSON.parse(jsonStr) as T;
}
