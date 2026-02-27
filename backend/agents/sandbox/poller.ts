// ============================================================================
// LAZARUS — Sandbox Poller
// Polls ECS Fargate sandbox task and reports completion to Step Functions
// ============================================================================

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { DescribeTasksCommand } from '@aws-sdk/client-ecs';
import { db } from '../../shared/dynamodb';
import { ws, WebSocketHelper } from '../../shared/websocket';
import { ecsClient, sfnClient } from '../../shared/aws-clients';
import { getConfig } from '../../shared/config';
import { log } from '../../shared/logger';
import { SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { WebSocketEventType, ProjectStatus } from '../../shared/types';

const config = getConfig();

export async function handler(event: {
  projectId: string;
  taskArn: string;
  taskToken?: string;
}): Promise<{ status: string; exitCode?: number }> {
  const { projectId, taskArn, taskToken } = event;

  log('info', 'Polling sandbox task', { projectId, taskArn });

  try {
    const result = await ecsClient.send(new DescribeTasksCommand({
      cluster: config.ecsClusterArn,
      tasks: [taskArn],
    }));

    const task = result.tasks?.[0];
    if (!task) {
      throw new Error(`Task ${taskArn} not found`);
    }

    const lastStatus = task.lastStatus ?? 'UNKNOWN';
    log('info', 'Sandbox task status', { projectId, taskArn, lastStatus });

    if (lastStatus === 'STOPPED') {
      const exitCode = task.containers?.[0]?.exitCode ?? 1;
      const success = exitCode === 0;

      // Update project status
      await db.update(config.projectsTable, { projectId }, {
        status: success ? ProjectStatus.SANDBOX_PASSED : ProjectStatus.SANDBOX_FAILED,
        sandboxCompletedAt: new Date().toISOString(),
      });

      // Notify WebSocket
      await ws.send(projectId, WebSocketHelper.createEvent(
        success ? WebSocketEventType.SANDBOX_PASSED : WebSocketEventType.SANDBOX_FAILED,
        projectId,
        { exitCode, taskArn }
      ));

      // Send task token to Step Functions if provided
      if (taskToken) {
        if (success) {
          await sfnClient.send(new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify({ projectId, sandboxPassed: true, exitCode }),
          }));
        } else {
          await sfnClient.send(new SendTaskFailureCommand({
            taskToken,
            error: 'SandboxFailed',
            cause: `Container exited with code ${exitCode}`,
          }));
        }
      }

      return { status: 'STOPPED', exitCode };
    }

    return { status: lastStatus };
  } catch (error) {
    log('error', 'Sandbox poller failed', { projectId, taskArn, error: String(error) });

    if (taskToken) {
      await sfnClient.send(new SendTaskFailureCommand({
        taskToken,
        error: 'PollerError',
        cause: String(error),
      })).catch(() => {});
    }

    throw error;
  }
}
