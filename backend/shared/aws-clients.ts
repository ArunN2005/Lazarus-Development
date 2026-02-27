// ============================================================================
// LAZARUS — AWS SDK v3 Client Singletons
// All clients configured with ap-south-1 region, adaptive retry
// ============================================================================

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { ECSClient } from '@aws-sdk/client-ecs';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { AppRunnerClient } from '@aws-sdk/client-apprunner';
import { ECRClient } from '@aws-sdk/client-ecr';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { XRayClient } from '@aws-sdk/client-xray';
import {
  ApiGatewayManagementApiClient,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { SNSClient } from '@aws-sdk/client-sns';
import { SFNClient } from '@aws-sdk/client-sfn';

const REGION = process.env['AWS_REGION'] ?? 'ap-south-1';

const commonConfig = {
  region: REGION,
  maxAttempts: 3,
  retryMode: 'adaptive' as const,
};

// ---------------------------------------------------------------------------
// DynamoDB
// ---------------------------------------------------------------------------
const rawDynamoClient = new DynamoDBClient(commonConfig);

export const dynamoClient = DynamoDBDocumentClient.from(rawDynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

// ---------------------------------------------------------------------------
// S3
// ---------------------------------------------------------------------------
export const s3Client = new S3Client(commonConfig);

// ---------------------------------------------------------------------------
// SQS
// ---------------------------------------------------------------------------
export const sqsClient = new SQSClient(commonConfig);

// ---------------------------------------------------------------------------
// Secrets Manager
// ---------------------------------------------------------------------------
export const secretsClient = new SecretsManagerClient(commonConfig);

// ---------------------------------------------------------------------------
// Bedrock Runtime (Claude models)
// ---------------------------------------------------------------------------
export const bedrockClient = new BedrockRuntimeClient({
  ...commonConfig,
  region: 'ap-south-1',
});

// ---------------------------------------------------------------------------
// ECS
// ---------------------------------------------------------------------------
export const ecsClient = new ECSClient(commonConfig);

// ---------------------------------------------------------------------------
// CodeBuild
// ---------------------------------------------------------------------------
export const codebuildClient = new CodeBuildClient(commonConfig);

// ---------------------------------------------------------------------------
// App Runner
// ---------------------------------------------------------------------------
export const appRunnerClient = new AppRunnerClient(commonConfig);

// ---------------------------------------------------------------------------
// ECR
// ---------------------------------------------------------------------------
export const ecrClient = new ECRClient(commonConfig);

// ---------------------------------------------------------------------------
// CloudWatch Logs
// ---------------------------------------------------------------------------
export const cloudwatchLogsClient = new CloudWatchLogsClient(commonConfig);

// ---------------------------------------------------------------------------
// X-Ray
// ---------------------------------------------------------------------------
export const xrayClient = new XRayClient(commonConfig);

// ---------------------------------------------------------------------------
// SNS
// ---------------------------------------------------------------------------
export const snsClient = new SNSClient(commonConfig);

// ---------------------------------------------------------------------------
// Step Functions
// ---------------------------------------------------------------------------
export const sfnClient = new SFNClient(commonConfig);

// ---------------------------------------------------------------------------
// API Gateway Management API (WebSocket)
// Factory — endpoint changes per deployment
// ---------------------------------------------------------------------------
export function createApiGatewayManagementClient(
  endpoint: string
): ApiGatewayManagementApiClient {
  return new ApiGatewayManagementApiClient({
    ...commonConfig,
    endpoint,
  });
}
