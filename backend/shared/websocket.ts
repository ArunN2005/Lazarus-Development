// ============================================================================
// LAZARUS — WebSocket Helper
// Manages WebSocket connections and event broadcasting
// ============================================================================

import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { createApiGatewayManagementClient } from './aws-clients';
import { db } from './dynamodb';
import { log } from './logger';
import type { WebSocketEvent, WSConnection } from './types';
import { getConfig } from './config';

export class WebSocketHelper {
  private apiClient: ReturnType<typeof createApiGatewayManagementClient> | null = null;

  private getClient() {
    if (!this.apiClient) {
      const config = getConfig();
      this.apiClient = createApiGatewayManagementClient(config.wsApiEndpoint);
    }
    return this.apiClient;
  }

  /**
   * Send event to all connections for a project
   */
  async send<T>(projectId: string, event: WebSocketEvent<T>): Promise<void> {
    const connections = await this.getConnections(projectId);

    if (connections.length === 0) {
      log('debug', 'No WebSocket connections for project', { projectId });
      return;
    }

    const data = JSON.stringify(event);
    const BATCH_SIZE = 10;

    for (let i = 0; i < connections.length; i += BATCH_SIZE) {
      const batch = connections.slice(i, i + BATCH_SIZE);
      const promises = batch.map((conn) =>
        this.sendToConnection(conn.connectionId, data).catch(() => {
          // Individual send failures are handled inside sendToConnection
        })
      );
      await Promise.all(promises);
    }
  }

  /**
   * Send directly to a specific connectionId
   */
  async sendToConnection(
    connectionId: string,
    data: string
  ): Promise<void> {
    const client = this.getClient();

    try {
      await client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: new TextEncoder().encode(data),
        })
      );
    } catch (error: unknown) {
      const err = error as { name?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } };

      // Handle stale connections
      if (
        err.name === 'GoneException' ||
        err.statusCode === 410 ||
        err.$metadata?.httpStatusCode === 410
      ) {
        log('info', 'Removing stale WebSocket connection', { connectionId });
        await this.unregisterConnection(connectionId);
        return;
      }

      // Handle throttling — retry once after 100ms
      if (err.name === 'ThrottlingException' || err.name === 'TooManyRequestsException') {
        log('warn', 'WebSocket throttled, retrying', { connectionId });
        await this.sleep(100);
        try {
          await client.send(
            new PostToConnectionCommand({
              ConnectionId: connectionId,
              Data: new TextEncoder().encode(data),
            })
          );
          return;
        } catch {
          log('error', 'WebSocket retry also failed', { connectionId });
          return;
        }
      }

      log('error', 'WebSocket send failed', {
        connectionId,
        error: String(error),
      });
    }
  }

  /**
   * Register a new WebSocket connection
   */
  async registerConnection(
    connectionId: string,
    projectId: string,
    userId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + 86400; // +24 hours

    const config = getConfig();

    await db.put(config.wsConnectionsTable, {
      connectionId,
      projectId,
      userId,
      connectedAt: now,
      ttl,
    });

    log('info', 'WebSocket connection registered', {
      connectionId,
      projectId,
      userId,
    });
  }

  /**
   * Unregister (delete) a WebSocket connection
   */
  async unregisterConnection(connectionId: string): Promise<void> {
    const config = getConfig();

    try {
      await db.delete(config.wsConnectionsTable, { connectionId });
      log('info', 'WebSocket connection unregistered', { connectionId });
    } catch (error) {
      log('warn', 'Failed to unregister WebSocket connection', {
        connectionId,
        error: String(error),
      });
    }
  }

  /**
   * Get all live connections for a project
   */
  async getConnections(projectId: string): Promise<WSConnection[]> {
    const config = getConfig();

    try {
      const connections = await db.queryGSI<WSConnection>(
        config.wsConnectionsTable,
        'projectId-index',
        'projectId',
        projectId
      );
      return connections;
    } catch (error) {
      log('error', 'Failed to get WebSocket connections', {
        projectId,
        error: String(error),
      });
      return [];
    }
  }

  /**
   * Create a standard WebSocket event object
   */
  static createEvent<T>(
    type: WebSocketEvent<T>['type'],
    projectId: string,
    payload: T
  ): WebSocketEvent<T> {
    return {
      type,
      projectId,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton export
export const ws = new WebSocketHelper();
