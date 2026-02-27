// ============================================================================
// LAZARUS — WebSocket Message Handler
// Handles incoming messages from WebSocket clients (default route)
// ============================================================================

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { log } from '../shared/logger';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const connectionId = event.requestContext.connectionId!;

  log('info', 'WebSocket message received', {
    connectionId,
    body: event.body?.substring(0, 200),
  });

  // Clients send ping messages to keep connection alive
  // Server-to-client messages are pushed via ApiGatewayManagementApi
  return { statusCode: 200, body: 'OK' };
}
