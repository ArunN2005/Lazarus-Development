// ============================================================================
// LAZARUS — Builder SQS Consumer
// Processes file generation messages from SQS queue (batch concurrency)
// ============================================================================

import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { db } from '../../shared/dynamodb';
import { s3 } from '../../shared/s3';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { costTracker } from '../../shared/costTracker';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { generateFile } from './fileGenerator';
import {
  WebSocketEventType,
  type MigrationPlanFile,
  type GenerationContext,
  type TechStack,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// SQS Handler
// ---------------------------------------------------------------------------

export async function handler(event: SQSEvent): Promise<{
  batchItemFailures: Array<{ itemIdentifier: string }>;
}> {
  const failures: string[] = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      log('error', 'Failed to process SQS record', {
        messageId: record.messageId,
        error: String(error),
      });
      failures.push(record.messageId);
    }
  }

  return {
    batchItemFailures: failures.map((id) => ({ itemIdentifier: id })),
  };
}

// ---------------------------------------------------------------------------
// Record processing
// ---------------------------------------------------------------------------

interface FileGenerationMessage {
  projectId: string;
  file: MigrationPlanFile;
  techStack: TechStack;
  planVersion: number;
}

async function processRecord(record: SQSRecord): Promise<void> {
  const config = getConfig();
  const message = JSON.parse(record.body) as FileGenerationMessage;
  const { projectId, file, techStack, planVersion } = message;

  log('info', 'Processing file generation', {
    projectId,
    targetPath: file.targetPath,
  });

  // Load context for this file
  const context = await loadContext(projectId, file, techStack);

  // Generate the file
  const content = await generateFile(file, context);

  // Upload to S3
  await s3.uploadText(
    config.projectsBucket,
    `${projectId}/generated/${file.targetPath}`,
    content
  );

  // Record generation in DynamoDB
  await db.put(config.fileGenerationsTable, {
    projectId,
    targetPath: file.targetPath,
    sourcePath: file.sourcePath ?? null,
    action: file.action,
    phase: file.phase,
    generatedAt: new Date().toISOString(),
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  });

  // Update project progress
  await db.atomicAdd(config.projectsTable, { projectId }, 'generatedFileCount', 1);

  // Send WebSocket update
  await ws.send(
    projectId,
    WebSocketHelper.createEvent(WebSocketEventType.FILE_GENERATED, projectId, {
      filePath: file.targetPath,
      action: file.action,
    })
  );
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

async function loadContext(
  projectId: string,
  file: MigrationPlanFile,
  techStack: TechStack
): Promise<GenerationContext> {
  const config = getConfig();

  const originalFiles = new Map<string, string>();
  const generatedFiles = new Map<string, string>();

  // Load original file if needed
  if (file.sourcePath && (file.action as string) === 'MIGRATE') {
    try {
      const content = await s3.download(
        config.projectsBucket,
        `${projectId}/original/${file.sourcePath}`
      );
      originalFiles.set(file.sourcePath, content);
    } catch {
      log('warn', 'Original file not found', {
        projectId,
        sourcePath: file.sourcePath,
      });
    }
  }

  // Load dependency files that have already been generated
  if (file.dependencies) {
    for (const dep of file.dependencies.slice(0, 5)) {
      try {
        const content = await s3.download(
          config.projectsBucket,
          `${projectId}/generated/${dep}`
        );
        generatedFiles.set(dep, content);
      } catch {
        // Dependency not generated yet — that's okay
      }
    }
  }

  // Load plan from S3
  const planJson = await s3.download(
    config.projectsBucket,
    `${projectId}/plans/v1.json`
  );
  const plan = JSON.parse(planJson);

  return {
    projectId,
    plan,
    originalFiles,
    generatedFiles,
    techStack,
  };
}
