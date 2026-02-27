// ============================================================================
// LAZARUS — Builder DLQ Handler
// Processes messages that failed all SQS retries
// ============================================================================

import type { SQSEvent } from 'aws-lambda';
import { db } from '../../shared/dynamodb';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { WebSocketEventType, ProjectStatus } from '../../shared/types';

const config = getConfig();

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body) as {
        projectId: string;
        filePath: string;
        batch: number;
      };

      const { projectId, filePath } = body;

      log('error', 'File generation permanently failed (DLQ)', {
        projectId,
        filePath,
        messageId: record.messageId,
        receiveCount: record.attributes.ApproximateReceiveCount,
      });

      // Mark file as failed in DynamoDB
      await db.update(
        config.fileGenerationsTable,
        { projectId, filePath },
        {
          status: 'failed',
          failedAt: new Date().toISOString(),
          failureReason: 'Exceeded maximum retry attempts',
        }
      );

      // Update project status if too many failures
      const project = await db.get(config.projectsTable, { projectId });
      if (project) {
        const failedCount = ((project.failedFileCount as number) ?? 0) + 1;
        await db.update(config.projectsTable, { projectId }, {
          failedFileCount: failedCount,
          status: failedCount > 3 ? ProjectStatus.FAILED : project.status,
        });
      }

      // Notify via WebSocket
      await ws.send(
        projectId,
        WebSocketHelper.createEvent(WebSocketEventType.FILE_GENERATION_FAILED, projectId, {
          filePath,
          reason: 'Exceeded maximum retry attempts',
        })
      );
    } catch (err) {
      log('error', 'DLQ handler failed to process record', {
        messageId: record.messageId,
        error: String(err),
      });
    }
  }
}
