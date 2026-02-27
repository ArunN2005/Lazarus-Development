// ============================================================================
// LAZARUS — Typed Configuration
// All environment variables accessed through this single config object
// ============================================================================

import { LazarusConfig } from './types';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

let _config: LazarusConfig | null = null;

export function getConfig(): LazarusConfig {
  if (_config) return _config;

  _config = {
    region: optionalEnv('AWS_REGION', 'ap-south-1'),
    accountId: requireEnv('AWS_ACCOUNT_ID'),
    projectsBucket: requireEnv('PROJECTS_BUCKET'),
    codebuildBucket: requireEnv('CODEBUILD_BUCKET'),
    overlayBucket: requireEnv('OVERLAY_BUCKET'),
    projectsTable: requireEnv('PROJECTS_TABLE'),
    migrationPlansTable: requireEnv('MIGRATION_PLANS_TABLE'),
    fileGenerationsTable: requireEnv('FILE_GENERATIONS_TABLE'),
    sandboxIterationsTable: requireEnv('SANDBOX_ITERATIONS_TABLE'),
    healLogsTable: requireEnv('HEAL_LOGS_TABLE'),
    costTrackingTable: requireEnv('COST_TRACKING_TABLE'),
    userProjectsTable: requireEnv('USER_PROJECTS_TABLE'),
    wsConnectionsTable: requireEnv('WS_CONNECTIONS_TABLE'),
    fileGenerationQueueUrl: requireEnv('FILE_GENERATION_QUEUE_URL'),
    fileGenerationDlqUrl: requireEnv('FILE_GENERATION_DLQ_URL'),
    redisUrl: optionalEnv('REDIS_URL', ''),
    wsApiUrl: requireEnv('WS_API_URL'),
    wsApiEndpoint: requireEnv('WS_API_ENDPOINT'),
    ecsClusterArn: requireEnv('ECS_CLUSTER_ARN'),
    githubMcpTaskDef: requireEnv('GITHUB_MCP_TASK_DEF'),
    websearchMcpTaskDef: requireEnv('WEBSEARCH_MCP_TASK_DEF'),
    sandboxTaskDef: requireEnv('SANDBOX_TASK_DEF'),
    codebuildProject: requireEnv('CODEBUILD_PROJECT'),
    ecrRepoUri: requireEnv('ECR_REPO_URI'),
    cognitoUserPoolId: requireEnv('COGNITO_USER_POOL_ID'),
    cognitoClientId: requireEnv('COGNITO_CLIENT_ID'),
    cognitoIssuer: requireEnv('COGNITO_ISSUER'),
    snsTopicArn: requireEnv('SNS_TOPIC_ARN'),
    vpcSubnets: requireEnv('VPC_SUBNETS'),
    securityGroup: requireEnv('SECURITY_GROUP'),
    // STATE_MACHINE_ARN is derived rather than injected as env var — injecting it would create
    // a CloudFormation circular dependency (SFN references Lambda tasks; Lambda would reference SFN).
    stateMachineArn: process.env['STATE_MACHINE_ARN'] ||
      `arn:aws:states:${process.env['AWS_REGION'] || 'ap-south-1'}:${process.env['AWS_ACCOUNT_ID']}:stateMachine:lazarus-pipeline`,
    overlayDomain: optionalEnv('OVERLAY_DOMAIN', 'overlay.lazarus.dev'),
    configBucket: optionalEnv('CONFIG_BUCKET', ''),
    appRunnerAccessRoleArn: optionalEnv('APPRUNNER_ACCESS_ROLE_ARN', ''),
  };

  return _config!;
}

/**
 * Lightweight config for API handlers that don't need all env vars
 */
export function getApiConfig(): Pick<
  LazarusConfig,
  | 'region'
  | 'projectsTable'
  | 'migrationPlansTable'
  | 'fileGenerationsTable'
  | 'costTrackingTable'
  | 'userProjectsTable'
  | 'wsConnectionsTable'
  | 'projectsBucket'
  | 'wsApiEndpoint'
  | 'cognitoUserPoolId'
  | 'cognitoClientId'
  | 'cognitoIssuer'
  | 'stateMachineArn'
> {
  return {
    region: optionalEnv('AWS_REGION', 'ap-south-1'),
    projectsTable: requireEnv('PROJECTS_TABLE'),
    migrationPlansTable: requireEnv('MIGRATION_PLANS_TABLE'),
    fileGenerationsTable: requireEnv('FILE_GENERATIONS_TABLE'),
    costTrackingTable: requireEnv('COST_TRACKING_TABLE'),
    userProjectsTable: requireEnv('USER_PROJECTS_TABLE'),
    wsConnectionsTable: requireEnv('WS_CONNECTIONS_TABLE'),
    projectsBucket: requireEnv('PROJECTS_BUCKET'),
    wsApiEndpoint: requireEnv('WS_API_ENDPOINT'),
    cognitoUserPoolId: requireEnv('COGNITO_USER_POOL_ID'),
    cognitoClientId: requireEnv('COGNITO_CLIENT_ID'),
    cognitoIssuer: requireEnv('COGNITO_ISSUER'),
    stateMachineArn: requireEnv('STATE_MACHINE_ARN'),
  };
}
