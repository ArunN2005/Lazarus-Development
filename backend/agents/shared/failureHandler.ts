// ============================================================================
// LAZARUS — Failure Handler
// Catches Step Functions pipeline errors and notifies users
// ============================================================================

import { db } from '../../shared/dynamodb';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { WebSocketEventType, ProjectStatus } from '../../shared/types';

const config = getConfig();

export async function handler(event: {
  projectId: string;
  phase?: number;
  error?: string;
  cause?: string;
  executionArn?: string;
}): Promise<void> {
  const { projectId, phase, error, cause } = event;

  log('error', 'Pipeline failure handler triggered', {
    projectId,
    phase,
    error,
    cause,
  });

  try {
    const failureReason = cause
      ? `${error ?? 'UnknownError'}: ${cause}`
      : (error ?? 'Pipeline execution failed');

    // Update project to FAILED status
    await db.update(config.projectsTable, { projectId }, {
      status: ProjectStatus.FAILED,
      failedAt: new Date().toISOString(),
      failureReason,
    });

    // Send WebSocket failure event
    await ws.send(
      projectId,
      WebSocketHelper.createEvent(WebSocketEventType.PHASE_FAILED, projectId, {
        phase,
        error,
        cause,
        message: `Lazarus encountered an error${phase ? ` during ${phase}` : ''}: ${error}`,
      })
    );

    log('info', 'Failure handler completed', { projectId });
  } catch (err) {
    log('error', 'Failure handler itself failed', {
      projectId,
      error: String(err),
    });
    // Don't re-throw — failure handler must not fail or it creates infinite loops
  }
}
