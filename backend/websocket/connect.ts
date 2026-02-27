// ============================================================================
// LAZARUS — WebSocket Connect Handler
// Registers new WebSocket connections and links them to a project
// ============================================================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { db } from '../shared/dynamodb';
import { getConfig } from '../shared/config';
import { log } from '../shared/logger';

const config = getConfig();
const TTL_HOURS = 24;

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId!;
  const projectId = event.queryStringParameters?.projectId ?? '';
  const userId = (event.requestContext as { authorizer?: { userId?: string } }).authorizer?.userId ?? 'anonymous';

  log('info', 'WebSocket connect', { connectionId, projectId, userId });

  try {
    const ttl = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;

    await db.put(config.wsConnectionsTable, {
      connectionId,
      projectId,
      userId,
      connectedAt: new Date().toISOString(),
      ttl,
    });

    log('info', 'WebSocket connection registered', { connectionId, projectId, userId });

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    log('error', 'WebSocket connect failed', { connectionId, error: String(error) });
    return { statusCode: 500, body: 'Connection failed' };
  }
}
