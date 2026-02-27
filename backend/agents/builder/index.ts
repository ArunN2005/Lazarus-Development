// ============================================================================
// LAZARUS — Builder Agent (Agent 3) — Orchestrator
// Coordinates file generation via SQS queue with concurrency control
// ============================================================================

import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { bedrock, MODELS } from '../../shared/bedrock';
import type { TechStack } from '../../shared/types';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { sqsClient } from '../../shared/aws-clients';
import { generateFile } from './fileGenerator';
import { reconcileImports } from './importReconciler';
import { computeDiff } from './diffComputer';
import {
  ProjectStatus,
  PhaseNumber,
  WebSocketEventType,
  type MigrationPlan,
  type MigrationPlanFile,
  type GenerationContext,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Handler — Lambda entry point (invoked by Step Functions)
// ---------------------------------------------------------------------------

export async function handler(event: {
  projectId: string;
  plan: MigrationPlan;
  planVersion: number;
}): Promise<{ projectId: string; generatedFiles: number; failedFiles: number }> {
  const config = getConfig();
  const { projectId, plan, planVersion } = event;

  log('info', 'Builder Agent starting', {
    projectId,
    totalFiles: plan.files.length,
    planVersion,
  });

  try {
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.BUILDING,
      currentPhase: PhaseNumber.BUILD,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_STARTED, projectId, {
        phase: PhaseNumber.BUILD,
        phaseName: 'Builder',
        message: `Generating ${plan.files.length} files...`,
      })
    );

    // Build generation context
    const context = await buildContext(projectId, plan);

    // Process files in phase order
    let generatedFiles = 0;
    let failedFiles = 0;

    const phases = [...new Set(plan.files.map((f) => f.phase))].sort();

    for (const phase of phases) {
      const phaseFiles = plan.files
        .filter((f) => f.phase === phase)
        .sort((a, b) => a.priority - b.priority);

      log('info', `Processing phase ${phase}`, {
        projectId,
        fileCount: phaseFiles.length,
      });

      await ws.send(
        projectId,
        WebSocketHelper.createEvent(WebSocketEventType.BUILD_PHASE, projectId, {
          phase,
          fileCount: phaseFiles.length,
          message: `Building phase ${phase}: ${phaseFiles.length} files`,
        })
      );

      // Process files with concurrency limit
      const concurrency = 5;
      for (let i = 0; i < phaseFiles.length; i += concurrency) {
        const batch = phaseFiles.slice(i, i + concurrency);

        const results = await Promise.allSettled(
          batch.map((file) => processFile(projectId, file, context, plan))
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const file = batch[j];

          if (result.status === 'fulfilled') {
            generatedFiles++;
            // Add to context for subsequent files
            context.generatedFiles?.set(file.targetPath ?? file.filePath, result.value);

            await ws.send(
              projectId,
              WebSocketHelper.createEvent(WebSocketEventType.FILE_GENERATED, projectId, {
                filePath: file.targetPath,
                action: file.action,
                generated: generatedFiles,
                total: plan.files.length,
              })
            );
          } else {
            failedFiles++;
            log('error', 'File generation failed', {
              projectId,
              filePath: file.targetPath,
              error: String(result.reason),
            });

            await ws.send(
              projectId,
              WebSocketHelper.createEvent(WebSocketEventType.FILE_FAILED, projectId, {
                filePath: file.targetPath,
                error: String(result.reason),
                generated: generatedFiles,
                total: plan.files.length,
              })
            );
          }
        }

        // Update project progress
        await db.update(config.projectsTable, { projectId }, {
          generatedFileCount: generatedFiles,
        });
      }
    }

    // Run import reconciliation
    log('info', 'Running import reconciliation', { projectId });
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.BUILD_PROGRESS, projectId, {
        message: 'Reconciling imports...',
      })
    );

    const reconciled = await reconcileImports(projectId, context);
    log('info', 'Import reconciliation complete', {
      projectId,
      fixedImports: reconciled,
    });

    // Update status
    const finalStatus = failedFiles === 0
      ? ProjectStatus.BUILD_COMPLETE
      : ProjectStatus.BUILD_PARTIAL;

    await db.update(config.projectsTable, { projectId }, {
      status: finalStatus,
      generatedFileCount: generatedFiles,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_COMPLETE, projectId, {
        phase: PhaseNumber.BUILD,
        phaseName: 'Builder',
        message: `Generated ${generatedFiles}/${plan.files.length} files.`,
        generatedFiles,
        failedFiles,
      })
    );

    return { projectId, generatedFiles, failedFiles };
  } catch (error) {
    log('error', 'Builder Agent failed', {
      projectId,
      error: String(error),
    });

    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason: `Builder: ${String(error)}`,
    });

    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase: PhaseNumber.BUILD,
        error: String(error),
      })
    );

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Build context (original files + plan)
// ---------------------------------------------------------------------------

async function buildContext(
  projectId: string,
  plan: MigrationPlan
): Promise<GenerationContext> {
  const config = getConfig();

  // Load original files from S3
  const originalFiles = new Map<string, string>();
  const fileKeys = await s3.list(config.projectsBucket, `${projectId}/original/`);

  for (const key of fileKeys) {
    const relativePath = key.replace(`${projectId}/original/`, '');
    if (!relativePath || relativePath.startsWith('_lazarus_')) continue;

    try {
      const content = await s3.download(config.projectsBucket, key);
      originalFiles.set(relativePath, content);
    } catch (error) {
      log('warn', 'Failed to load original file', {
        projectId,
        key,
        error: String(error),
      });
    }
  }

  return {
    projectId,
    plan,
    originalFiles,
    generatedFiles: new Map<string, string>(),
    techStack: (plan.targetStack ?? plan.sourceStack) as TechStack,
  };
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------

async function processFile(
  projectId: string,
  file: MigrationPlanFile,
  context: GenerationContext,
  plan: MigrationPlan
): Promise<string> {
  const config = getConfig();

  log('info', 'Generating file', {
    projectId,
    targetPath: file.targetPath,
    action: file.action,
  });

  let generatedContent: string;

  switch (file.action as string) {
    case 'COPY':
    case 'copy': {
      // Just copy original file to target
      const original = context.originalFiles?.get(file.sourcePath ?? file.sourceFilePath ?? '');
      if (!original) {
        throw new Error(`Original file not found: ${file.sourcePath ?? file.sourceFilePath}`);
      }
      generatedContent = original;
      break;
    }

    case 'DELETE': {
      // Mark as deleted — nothing to generate
      generatedContent = '';
      break;
    }

    case 'RENAME': {
      const original = context.originalFiles?.get(file.sourcePath ?? file.sourceFilePath ?? '');
      if (!original) {
        throw new Error(`Original file not found: ${file.sourcePath ?? file.sourceFilePath}`);
      }
      generatedContent = original;
      break;
    }

    case 'MIGRATE':
    case 'CREATE':
    default: {
      generatedContent = await generateFile(file, context);
      break;
    }
  }

  // Upload to S3
  if (generatedContent) {
    await s3.uploadText(
      config.projectsBucket,
      `${projectId}/generated/${file.targetPath}`,
      generatedContent
    );

    // Compute and store diff if migrating
    if ((file.action as string) === 'MIGRATE' && file.sourcePath) {
      const originalContent = context.originalFiles?.get(file.sourcePath) ?? '';
      const diff = computeDiff(originalContent, generatedContent, file.sourcePath, file.targetPath ?? file.filePath);

      await db.put(config.fileGenerationsTable, {
        projectId,
        filePath: file.targetPath,   // table partition key
        targetPath: file.targetPath,
        sourcePath: file.sourcePath ?? null,
        action: file.action,
        phase: file.phase,
        generatedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(generatedContent, 'utf8'),
        diff,
      });
    } else {
      await db.put(config.fileGenerationsTable, {
        projectId,
        filePath: file.targetPath,   // table partition key
        targetPath: file.targetPath,
        sourcePath: file.sourcePath ?? null,
        action: file.action,
        phase: file.phase,
        generatedAt: new Date().toISOString(),
        sizeBytes: Buffer.byteLength(generatedContent, 'utf8'),
        diff: null,
      });
    }
  }

  return generatedContent;
}
