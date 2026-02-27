// ============================================================================
// LAZARUS — WebSocket Disconnect Handler
// Removes connection record when client disconnects
// ============================================================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { db } from '../shared/dynamodb';
import { getConfig } from '../shared/config';
import { log } from '../shared/logger';

const config = getConfig();

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId!;

  log('info', 'WebSocket disconnect', { connectionId });

  try {
    await db.delete(config.wsConnectionsTable, { connectionId });
    log('info', 'WebSocket connection removed', { connectionId });
    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    log('warn', 'WebSocket disconnect cleanup failed (non-fatal)', {
      connectionId,
      error: String(error),
    });
    return { statusCode: 200, body: 'Disconnected' };
  }
}
