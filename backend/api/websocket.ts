// ============================================================================
// LAZARUS — WebSocket Handlers
// Manages WebSocket API Gateway connections
// ============================================================================

import { db } from '../shared/dynamodb';
import { ws, WebSocketHelper } from '../shared/websocket';
import { getConfig } from '../shared/config';
import { log } from '../shared/logger';
import { WebSocketEventType } from '../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebSocketEvent {
  requestContext: {
    connectionId: string;
    routeKey: string;
    domainName: string;
    stage: string;
  };
  body?: string;
}

interface WebSocketResponse {
  statusCode: number;
  body?: string;
}

// ============================================================================
// $connect
// ============================================================================

export async function connectHandler(event: WebSocketEvent): Promise<WebSocketResponse> {
  const { connectionId } = event.requestContext;

  log('info', 'WebSocket connect', { connectionId });

  // Connection is stored when client sends subscribe message
  return { statusCode: 200 };
}

// ============================================================================
// $disconnect
// ============================================================================

export async function disconnectHandler(event: WebSocketEvent): Promise<WebSocketResponse> {
  const config = getConfig();
  const { connectionId } = event.requestContext;

  log('info', 'WebSocket disconnect', { connectionId });

  try {
    // Find and remove connection from all projects
    const connections = await db.query(
      config.wsConnectionsTable,
      'connectionId',
      connectionId
    );

    for (const conn of connections.items) {
      const record = conn as Record<string, string>;
      await ws.unregisterConnection(record.connectionId);
    }
  } catch (error) {
    log('warn', 'Error during disconnect cleanup', {
      connectionId,
      error: String(error),
    });
  }

  return { statusCode: 200 };
}

// ============================================================================
// $default — Handle all messages
// ============================================================================

export async function defaultHandler(event: WebSocketEvent): Promise<WebSocketResponse> {
  const { connectionId } = event.requestContext;

  try {
    const body = JSON.parse(event.body ?? '{}');
    const { action, projectId, data } = body;

    switch (action) {
      case 'subscribe': {
        // Subscribe to project updates
        if (!projectId) {
          await ws.sendToConnection(connectionId, JSON.stringify({
            type: 'error',
            message: 'projectId is required',
          }));
          return { statusCode: 400 };
        }

        await ws.registerConnection(connectionId, projectId, 'anonymous');

        await ws.sendToConnection(connectionId, JSON.stringify({
          type: 'subscribed',
          projectId,
          message: `Subscribed to project ${projectId}`,
        }));

        log('info', 'Client subscribed', { connectionId, projectId });
        return { statusCode: 200 };
      }

      case 'unsubscribe': {
        if (!projectId) {
          return { statusCode: 400 };
        }

        await ws.unregisterConnection(connectionId);

        await ws.sendToConnection(connectionId, JSON.stringify({
          type: 'unsubscribed',
          projectId,
        }));

        log('info', 'Client unsubscribed', { connectionId, projectId });
        return { statusCode: 200 };
      }

      case 'ping': {
        await ws.sendToConnection(connectionId, JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
        }));
        return { statusCode: 200 };
      }

      case 'getStatus': {
        if (!projectId) {
          return { statusCode: 400 };
        }

        const config = getConfig();
        const project = await db.get(config.projectsTable, { projectId });

        if (project) {
          await ws.sendToConnection(connectionId, JSON.stringify({
            type: 'status',
            projectId,
            project,
          }));
        } else {
          await ws.sendToConnection(connectionId, JSON.stringify({
            type: 'error',
            message: 'Project not found',
          }));
        }

        return { statusCode: 200 };
      }

      default: {
        await ws.sendToConnection(connectionId, JSON.stringify({
          type: 'error',
          message: `Unknown action: ${action}`,
        }));
        return { statusCode: 400 };
      }
    }
  } catch (error) {
    log('error', 'WebSocket message error', {
      connectionId,
      error: String(error),
    });

    try {
      await ws.sendToConnection(connectionId, JSON.stringify({
        type: 'error',
        message: 'Internal server error',
      }));
    } catch {
      // Connection might be gone
    }

    return { statusCode: 500 };
  }
}

// ============================================================================
// Lambda Router
// ============================================================================

export async function handler(event: WebSocketEvent): Promise<WebSocketResponse> {
  const routeKey = event.requestContext.routeKey;

  switch (routeKey) {
    case '$connect':
      return connectHandler(event);
    case '$disconnect':
      return disconnectHandler(event);
    case '$default':
    default:
      return defaultHandler(event);
  }
}
