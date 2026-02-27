// ============================================================================
// LAZARUS — Notify Complete
// Sends final resurrection_complete event after successful validation
// ============================================================================

import { db } from '../../shared/dynamodb';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { snsClient } from '../../shared/aws-clients';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { WebSocketEventType, ProjectStatus } from '../../shared/types';
import { PublishCommand } from '@aws-sdk/client-sns';

const config = getConfig();

export async function handler(event: {
  projectId: string;
  liveUrl: string;
  healthScore: number;
  totalCost: number;
  durationMs: number;
}): Promise<void> {
  const { projectId, liveUrl, healthScore, totalCost, durationMs } = event;

  log('info', 'Notifying resurrection complete', {
    projectId,
    liveUrl,
    healthScore,
    totalCost,
  });

  try {
    // Update project as complete
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.COMPLETE,
      completedAt: new Date().toISOString(),
      liveUrl,
      healthScore,
      totalCost,
      durationMs,
    });

    // Send WebSocket resurrection_complete event
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.RESURRECTION_COMPLETE, projectId, {
        liveUrl,
        healthScore,
        totalCost,
        durationMs,
        message: `Your app has been resurrected! Live at: ${liveUrl}`,
      })
    );

    // Send SNS notification
    try {
      const project = await db.get(config.projectsTable, { projectId });
      if (project?.userEmail) {
        await snsClient.send(new PublishCommand({
          TopicArn: config.snsTopicArn,
          Subject: '🎉 Lazarus: Your resurrection is complete!',
          Message: [
            `Your legacy code has been successfully modernized!`,
            ``,
            `Live URL: ${liveUrl}`,
            `Health Score: ${healthScore}/100`,
            `Total Cost: $${totalCost.toFixed(2)}`,
            `Duration: ${Math.round(durationMs / 1000)}s`,
            ``,
            `Dashboard: https://app.lazarus.dev/project/${projectId}`,
          ].join('\n'),
        }));
      }
    } catch (snsError) {
      log('warn', 'SNS notification failed (non-fatal)', {
        projectId,
        error: String(snsError),
      });
    }

    log('info', 'Resurrection complete notification sent', { projectId });
  } catch (error) {
    log('error', 'NotifyComplete failed', { projectId, error: String(error) });
    throw error;
  }
}
