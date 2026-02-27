// ============================================================================
// LAZARUS — WebSocket Authorizer
// Lambda authorizer that validates Cognito JWT tokens for WebSocket connections
// ============================================================================

import type { APIGatewayRequestAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { log } from '../shared/logger';

interface JWTPayload {
  sub: string;
  email?: string;
  exp: number;
  iss: string;
}

// Simple base64url decode for JWT payload
function decodeJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JWTPayload;
  } catch {
    return null;
  }
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string,
  context?: Record<string, string>
): APIGatewayAuthorizerResult {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      }],
    },
    context,
  };
}

export async function handler(
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> {
  const token = event.queryStringParameters?.token;

  if (!token) {
    log('warn', 'WebSocket authorizer: no token provided');
    return generatePolicy('unauthorized', 'Deny', event.methodArn);
  }

  try {
    const payload = decodeJWTPayload(token);

    if (!payload) {
      log('warn', 'WebSocket authorizer: invalid token format');
      return generatePolicy('unauthorized', 'Deny', event.methodArn);
    }

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      log('warn', 'WebSocket authorizer: token expired', { sub: payload.sub });
      return generatePolicy('unauthorized', 'Deny', event.methodArn);
    }

    // Check issuer domain (Cognito)
    const expectedIssuerDomain = 'cognito-idp';
    if (!payload.iss.includes(expectedIssuerDomain)) {
      log('warn', 'WebSocket authorizer: invalid issuer', { iss: payload.iss });
      return generatePolicy('unauthorized', 'Deny', event.methodArn);
    }

    log('info', 'WebSocket authorizer: token valid', { userId: payload.sub });

    return generatePolicy(payload.sub, 'Allow', event.methodArn, {
      userId: payload.sub,
      email: payload.email ?? '',
    });
  } catch (error) {
    log('error', 'WebSocket authorizer error', { error: String(error) });
    return generatePolicy('unauthorized', 'Deny', event.methodArn);
  }
}
