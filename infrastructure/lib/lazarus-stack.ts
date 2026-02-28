// ============================================================================
// LAZARUS — AWS CDK Infrastructure Stack
// Single stack provisioning ALL AWS resources for the Lazarus platform
// ============================================================================

import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigatewayv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

const TAGS = { Project: 'Lazarus', Environment: 'production' };

export class LazarusStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        region: 'ap-south-1',
        account: process.env['CDK_DEFAULT_ACCOUNT'],
      },
    });

    const accountId = cdk.Stack.of(this).account;

    // -----------------------------------------------------------------------
    // VPC
    // -----------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'LazarusVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    // VPC Endpoints
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });
    vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
    vpc.addInterfaceEndpoint('CloudWatchEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    // Security Groups
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    const redisSg = new ec2.SecurityGroup(this, 'RedisSG', {
      vpc,
      description: 'Security group for ElastiCache Redis',
    });
    redisSg.addIngressRule(
      lambdaSg,
      ec2.Port.tcp(6379),
      'Allow Lambda to connect to Redis'
    );

    const ecsSg = new ec2.SecurityGroup(this, 'ECSSG', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });

    // -----------------------------------------------------------------------
    // S3 Buckets
    // -----------------------------------------------------------------------
    const projectsBucket = new s3.Bucket(this, 'ProjectsBucket', {
      bucketName: `lazarus-projects-${accountId}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['https://app.lazarus.dev'],
          allowedHeaders: ['*'],
        },
      ],
      lifecycleRules: [
        {
          prefix: 'builds/',
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    const codebuildBucket = new s3.Bucket(this, 'CodeBuildBucket', {
      bucketName: `lazarus-codebuild-${accountId}`,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    const overlayBucket = new s3.Bucket(this, 'OverlayBucket', {
      bucketName: `lazarus-overlay-${accountId}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // -----------------------------------------------------------------------
    // DynamoDB Tables
    // -----------------------------------------------------------------------
    const projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
      tableName: 'lazarus-projects',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
    });
    projectsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    projectsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    const migrationPlansTable = new dynamodb.Table(this, 'MigrationPlansTable', {
      tableName: 'lazarus-migration-plans',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const fileGenerationsTable = new dynamodb.Table(this, 'FileGenerationsTable', {
      tableName: 'lazarus-file-generations',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'filePath', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    fileGenerationsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
    });

    const sandboxIterationsTable = new dynamodb.Table(this, 'SandboxIterationsTable', {
      tableName: 'lazarus-sandbox-iterations',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'iterationNumber', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const healLogsTable = new dynamodb.Table(this, 'HealLogsTable', {
      tableName: 'lazarus-heal-logs',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const costTrackingTable = new dynamodb.Table(this, 'CostTrackingTable', {
      tableName: 'lazarus-cost-tracking',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    costTrackingTable.addGlobalSecondaryIndex({
      indexName: 'service-index',
      partitionKey: { name: 'service', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
    });

    const userProjectsTable = new dynamodb.Table(this, 'UserProjectsTable', {
      tableName: 'lazarus-user-projects',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const wsConnectionsTable = new dynamodb.Table(this, 'WSConnectionsTable', {
      tableName: 'lazarus-ws-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });
    wsConnectionsTable.addGlobalSecondaryIndex({
      indexName: 'projectId-index',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
    });

    // -----------------------------------------------------------------------
    // SQS Queues
    // -----------------------------------------------------------------------
    const fileGenerationDlq = new sqs.Queue(this, 'FileGenerationDLQ', {
      queueName: 'lazarus-file-generation-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const fileGenerationQueue = new sqs.Queue(this, 'FileGenerationQueue', {
      queueName: 'lazarus-file-generation-queue',
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: fileGenerationDlq,
        maxReceiveCount: 3,
      },
    });

    // -----------------------------------------------------------------------
    // ElastiCache Redis
    // -----------------------------------------------------------------------
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Lazarus Redis subnet group',
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: 'lazarus-redis-subnet',
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      clusterName: 'lazarus-redis',
      engine: 'redis',
      cacheNodeType: 'cache.t3.micro',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
    });
    redisCluster.addDependency(redisSubnetGroup);

    // -----------------------------------------------------------------------
    // SNS Topic
    // -----------------------------------------------------------------------
    const notificationsTopic = new sns.Topic(this, 'NotificationsTopic', {
      topicName: 'lazarus-notifications',
      displayName: 'Lazarus Notifications',
    });

    // -----------------------------------------------------------------------
    // Secrets Manager — import pre-existing secrets (created manually before CDK deploy)
    // -----------------------------------------------------------------------
    secretsmanager.Secret.fromSecretNameV2(this, 'GitHubAppClientId', 'lazarus/github-app-client-id');
    secretsmanager.Secret.fromSecretNameV2(this, 'GitHubAppClientSecret', 'lazarus/github-app-client-secret');
    secretsmanager.Secret.fromSecretNameV2(this, 'TavilyApiKey', 'lazarus/tavily-api-key');

    // -----------------------------------------------------------------------
    // ECR Repositories
    // -----------------------------------------------------------------------
    const githubMcpRepo = new ecr.Repository(this, 'GitHubMCPRepo', {
      repositoryName: 'lazarus-github-mcp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ maxImageCount: 5 }],
      imageScanOnPush: true,
    });

    const websearchMcpRepo = new ecr.Repository(this, 'WebSearchMCPRepo', {
      repositoryName: 'lazarus-websearch-mcp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ maxImageCount: 5 }],
      imageScanOnPush: true,
    });

    const sandboxRepo = new ecr.Repository(this, 'SandboxRepo', {
      repositoryName: 'lazarus-sandbox',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ maxImageCount: 5 }],
      imageScanOnPush: true,
    });

    const appRepo = new ecr.Repository(this, 'AppRepo', {
      repositoryName: 'lazarus-apps',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ maxImageCount: 10 }],
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
    });

    // -----------------------------------------------------------------------
    // ECS Cluster
    // -----------------------------------------------------------------------
    const ecsCluster = new ecs.Cluster(this, 'LazarusCluster', {
      clusterName: 'lazarus-cluster',
      vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
    });
    ecsCluster.addDefaultCapacityProviderStrategy([
      { capacityProvider: 'FARGATE', weight: 1 },
      { capacityProvider: 'FARGATE_SPOT', weight: 3 },
    ]);

    // ECS Task Roles
    const ecsTaskRole = new iam.Role(this, 'ECSTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('SecretsManagerReadWrite'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
      ],
    });

    const ecsExecRole = new iam.Role(this, 'ECSExecRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });

    // GitHub MCP Task Definition
    const githubMcpTaskDef = new ecs.FargateTaskDefinition(this, 'GitHubMCPTaskDef', {
      family: 'lazarus-github-mcp',
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole: ecsTaskRole,
      executionRole: ecsExecRole,
    });
    const githubMcpLogGroup = new logs.LogGroup(this, 'GitHubMCPLogs', {
      logGroupName: '/lazarus/mcp/github',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    githubMcpTaskDef.addContainer('github-mcp', {
      image: ecs.ContainerImage.fromEcrRepository(githubMcpRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: githubMcpLogGroup,
        streamPrefix: 'github-mcp',
      }),
      environment: {
        S3_BUCKET: projectsBucket.bucketName,
        AWS_REGION: 'ap-south-1',
      },
      portMappings: [{ containerPort: 3001 }],
    });

    // WebSearch MCP Task Definition
    const websearchMcpTaskDef = new ecs.FargateTaskDefinition(this, 'WebSearchMCPTaskDef', {
      family: 'lazarus-websearch-mcp',
      cpu: 256,
      memoryLimitMiB: 512,
      taskRole: ecsTaskRole,
      executionRole: ecsExecRole,
    });
    const websearchMcpLogGroup = new logs.LogGroup(this, 'WebSearchMCPLogs', {
      logGroupName: '/lazarus/mcp/websearch',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    websearchMcpTaskDef.addContainer('websearch-mcp', {
      image: ecs.ContainerImage.fromEcrRepository(websearchMcpRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: websearchMcpLogGroup,
        streamPrefix: 'websearch-mcp',
      }),
      environment: {
        AWS_REGION: 'ap-south-1',
      },
      portMappings: [{ containerPort: 3002 }],
    });

    // Sandbox Task Definition
    const sandboxTaskDef = new ecs.FargateTaskDefinition(this, 'SandboxTaskDef', {
      family: 'lazarus-sandbox',
      cpu: 1024,
      memoryLimitMiB: 2048,
      taskRole: ecsTaskRole,
      executionRole: ecsExecRole,
      ephemeralStorageGiB: 21,
    });
    const sandboxLogGroup = new logs.LogGroup(this, 'SandboxLogs', {
      logGroupName: '/lazarus/sandbox',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    sandboxTaskDef.addContainer('sandbox', {
      image: ecs.ContainerImage.fromEcrRepository(sandboxRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        logGroup: sandboxLogGroup,
        streamPrefix: 'sandbox',
      }),
      environment: {
        S3_BUCKET: projectsBucket.bucketName,
        AWS_REGION: 'ap-south-1',
        REDIS_URL: `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
      },
      portMappings: [{ containerPort: 3000 }],
    });

    // -----------------------------------------------------------------------
    // Cognito User Pool
    // -----------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'LazarusUserPool', {
      userPoolName: 'lazarus-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true, username: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true },
      },
    });

    const userPoolClient = userPool.addClient('FrontendClient', {
      userPoolClientName: 'lazarus-frontend-client',
      authFlows: {
        userSrp: true,
        custom: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ['https://app.lazarus.dev/auth/callback', 'http://localhost:3000/auth/callback'],
        logoutUrls: ['https://app.lazarus.dev', 'http://localhost:3000'],
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: 'lazarus-auth' },
    });

    // Lambda layer removed — NodejsFunction bundles each Lambda independently via esbuild

    // -----------------------------------------------------------------------
    // Common Lambda environment variables
    // -----------------------------------------------------------------------
    // These values are resolved lazily because their resources are created after commonEnv
    let _wsApiUrl = '';
    let _wsApiEndpoint = '';

    const commonEnv: Record<string, string> = {
      AWS_ACCOUNT_ID: accountId,
      PROJECTS_BUCKET: projectsBucket.bucketName,
      CODEBUILD_BUCKET: codebuildBucket.bucketName,
      OVERLAY_BUCKET: overlayBucket.bucketName,
      PROJECTS_TABLE: projectsTable.tableName,
      MIGRATION_PLANS_TABLE: migrationPlansTable.tableName,
      FILE_GENERATIONS_TABLE: fileGenerationsTable.tableName,
      SANDBOX_ITERATIONS_TABLE: sandboxIterationsTable.tableName,
      HEAL_LOGS_TABLE: healLogsTable.tableName,
      COST_TRACKING_TABLE: costTrackingTable.tableName,
      USER_PROJECTS_TABLE: userProjectsTable.tableName,
      WS_CONNECTIONS_TABLE: wsConnectionsTable.tableName,
      FILE_GENERATION_QUEUE_URL: fileGenerationQueue.queueUrl,
      FILE_GENERATION_DLQ_URL: fileGenerationDlq.queueUrl,
      REDIS_URL: `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
      ECS_CLUSTER_ARN: ecsCluster.clusterArn,
      GITHUB_MCP_TASK_DEF: githubMcpTaskDef.taskDefinitionArn,
      WEBSEARCH_MCP_TASK_DEF: websearchMcpTaskDef.taskDefinitionArn,
      SANDBOX_TASK_DEF: sandboxTaskDef.taskDefinitionArn,
      ECR_REPO_URI: appRepo.repositoryUri,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      COGNITO_ISSUER: `https://cognito-idp.ap-south-1.amazonaws.com/${userPool.userPoolId}`,
      SNS_TOPIC_ARN: notificationsTopic.topicArn,
      VPC_SUBNETS: vpc.privateSubnets.map((s) => s.subnetId).join(','),
      SECURITY_GROUP: lambdaSg.securityGroupId,
      WS_API_URL: cdk.Lazy.string({ produce: () => _wsApiUrl }),
      WS_API_ENDPOINT: cdk.Lazy.string({ produce: () => _wsApiEndpoint }),
      // STATE_MACHINE_ARN is intentionally NOT here — adding it creates a CloudFormation circular
      // dependency (SFN→Lambda tasks + Lambda→SFN ARN). It is derived at runtime in config.ts
      // from AWS_ACCOUNT_ID + AWS_REGION + the known state machine name 'lazarus-pipeline'.
      CODEBUILD_PROJECT: 'lazarus-docker-build',
    };

    // Common Lambda IAM role
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaVPCAccessExecutionRole'
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant permissions to Lambda role
    projectsBucket.grantReadWrite(lambdaRole);
    codebuildBucket.grantReadWrite(lambdaRole);
    overlayBucket.grantReadWrite(lambdaRole);
    projectsTable.grantReadWriteData(lambdaRole);
    migrationPlansTable.grantReadWriteData(lambdaRole);
    fileGenerationsTable.grantReadWriteData(lambdaRole);
    sandboxIterationsTable.grantReadWriteData(lambdaRole);
    healLogsTable.grantReadWriteData(lambdaRole);
    costTrackingTable.grantReadWriteData(lambdaRole);
    userProjectsTable.grantReadWriteData(lambdaRole);
    wsConnectionsTable.grantReadWriteData(lambdaRole);
    fileGenerationQueue.grantSendMessages(lambdaRole);
    fileGenerationQueue.grantConsumeMessages(lambdaRole);
    notificationsTopic.grantPublish(lambdaRole);

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecs:RunTask',
          'ecs:DescribeTasks',
          'ecs:StopTask',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [ecsTaskRole.roleArn, ecsExecRole.roleArn],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'codebuild:StartBuild',
          'codebuild:BatchGetBuilds',
          'codebuild:BatchGetProjects',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'apprunner:CreateService',
          'apprunner:UpdateService',
          'apprunner:DescribeService',
          'apprunner:ListServices',
          'apprunner:DeleteService',
        ],
        resources: ['*'],
      })
    );

    // Allow Lambda to create the App Runner service-linked role on first use
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:CreateServiceLinkedRole', 'iam:PassRole'],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchCheckLayerAvailability',
          'ecr:CreateRepository',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutLifecyclePolicy',
          'ecr:SetRepositoryPolicy',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:CreateSecret',
          'secretsmanager:UpdateSecret',
          'secretsmanager:DeleteSecret',
          'secretsmanager:DescribeSecret',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'states:SendTaskSuccess',
          'states:SendTaskFailure',
          'states:StartExecution',
          'states:DescribeExecution',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:FilterLogEvents',
          'logs:GetLogEvents',
          'xray:GetTraceSummaries',
          'xray:BatchGetTraces',
        ],
        resources: ['*'],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: ['*'],
      })
    );

    // -----------------------------------------------------------------------
    // Lambda function factory
    // -----------------------------------------------------------------------
    const createLambda = (
      id: string,
      entryFile: string,
      opts?: {
        timeout?: cdk.Duration;
        memorySize?: number;
        reservedConcurrency?: number;
        environment?: Record<string, string>;
      }
    ): lambda.Function => {
      const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/lazarus/${id.toLowerCase()}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const fn = new lambdaNodejs.NodejsFunction(this, id, {
        functionName: `lazarus-${id.toLowerCase()}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.join(__dirname, '../../', entryFile),
        handler: 'handler',
        timeout: opts?.timeout ?? cdk.Duration.seconds(900),
        memorySize: opts?.memorySize ?? 512,
        reservedConcurrentExecutions: opts?.reservedConcurrency,
        role: lambdaRole,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [lambdaSg],
        environment: {
          ...commonEnv,
          ...opts?.environment,
        },
        tracing: lambda.Tracing.ACTIVE,
        logGroup,
        bundling: {
          externalModules: ['@aws-sdk/*'],
          minify: false,
          sourceMap: false,
          target: 'node20',
          format: lambdaNodejs.OutputFormat.CJS,
        },
        depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
      });

      return fn;
    };

    // -----------------------------------------------------------------------
    // Agent Lambda Functions
    // -----------------------------------------------------------------------
    const inspectorFn = createLambda('Inspector', 'backend/agents/inspector/index.ts', {});

    const architectFn = createLambda('Architect', 'backend/agents/architect/index.ts', {});

    const builderFn = createLambda('Builder', 'backend/agents/builder/index.ts', {});

    const builderConsumerFn = createLambda('BuilderConsumer', 'backend/agents/builder/consumer.ts', {});
    builderConsumerFn.addEventSource(
      new lambdaEventSources.SqsEventSource(fileGenerationQueue, {
        batchSize: 1,
        maxConcurrency: 5,
      })
    );

    const builderDlqFn = createLambda('BuilderDLQ', 'backend/agents/builder/dlqHandler.ts', {
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    });
    builderDlqFn.addEventSource(
      new lambdaEventSources.SqsEventSource(fileGenerationDlq, {
        batchSize: 1,
      })
    );

    const sandboxPollerFn = createLambda('SandboxPoller', 'backend/agents/sandbox/poller.ts', {});

    const deployerFn = createLambda('Deployer', 'backend/agents/deployer/index.ts', {});

    const validatorFn = createLambda('Validator', 'backend/agents/validator/index.ts', {});

    const failureHandlerFn = createLambda('FailureHandler', 'backend/agents/shared/failureHandler.ts', {
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: { HANDLER: 'failure' },
    });

    const notifyCompleteFn = createLambda('NotifyComplete', 'backend/agents/shared/notifyComplete.ts', {
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: { HANDLER: 'notify' },
    });

    // -----------------------------------------------------------------------
    // API Lambda Functions
    // -----------------------------------------------------------------------
    const apiLambdaOpts = {
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
    };

    const createProjectFn = createLambda('CreateProject', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'createProject' },
    });
    const listProjectsFn = createLambda('ListProjects', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'listProjects' },
    });
    const getProjectFn = createLambda('GetProject', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'getProject' },
    });
    const deleteProjectFn = createLambda('DeleteProject', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'deleteProject' },
    });
    const getPlanFn = createLambda('GetPlan', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'getPlan' },
    });
    const approvePlanFn = createLambda('ApprovePlan', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'approvePlan' },
    });
    const createPRFn = createLambda('CreatePR', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'createPR' },
    });
    const submitEnvVarsFn = createLambda('SubmitEnvVars', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'submitEnvVars' },
    });
    const getCostFn = createLambda('GetCost', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'getCost' },
    });
    const getDiffsFn = createLambda('GetDiffs', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'getDiffs' },
    });
    const getFilesFn = createLambda('GetFiles', 'backend/api/handlers.ts', {
      ...apiLambdaOpts,
      environment: { HANDLER: 'getFiles' },
    });

    // -----------------------------------------------------------------------
    // WebSocket Lambda Functions
    // -----------------------------------------------------------------------
    const wsConnectFn = createLambda('WSConnect', 'backend/websocket/connect.ts', {
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });
    const wsDisconnectFn = createLambda('WSDisconnect', 'backend/websocket/disconnect.ts', {
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });
    const wsMessageFn = createLambda('WSMessage', 'backend/websocket/message.ts', {
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });
    const wsAuthorizerFn = createLambda('WSAuthorizer', 'backend/websocket/authorizer.ts', {
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
    });

    // -----------------------------------------------------------------------
    // Step Functions State Machine
    // -----------------------------------------------------------------------
    const inspectRepo = new sfnTasks.LambdaInvoke(this, 'InspectRepo', {
      lambdaFunction: inspectorFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    inspectRepo.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const waitForEnvVars = new sfn.Wait(this, 'WaitForEnvVars', {
      time: sfn.WaitTime.timestampPath('$.waitUntil'),
    });

    // Use a choice to check if env vars are needed
    // NOTE: Choice states are terminal in CDK chains; branches must explicitly
    // route to the next task in the workflow.
    const generatePlan = new sfnTasks.LambdaInvoke(this, 'GeneratePlan', {
      lambdaFunction: architectFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    generatePlan.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const waitForApproval = new sfn.Pass(this, 'WaitForApproval', {
      comment: 'Waiting for user plan approval via callback token',
    });

    const generateCode = new sfnTasks.LambdaInvoke(this, 'GenerateCode', {
      lambdaFunction: builderFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    generateCode.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const runSandbox = new sfnTasks.LambdaInvoke(this, 'RunSandbox', {
      lambdaFunction: sandboxPollerFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    runSandbox.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const deployApp = new sfnTasks.LambdaInvoke(this, 'DeployApp', {
      lambdaFunction: deployerFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    deployApp.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const validateDeployment = new sfnTasks.LambdaInvoke(this, 'ValidateDeployment', {
      lambdaFunction: validatorFn,
      outputPath: '$.Payload',
      retryOnServiceExceptions: true,
    });
    validateDeployment.addRetry({
      maxAttempts: 3,
      interval: cdk.Duration.seconds(30),
      backoffRate: 2,
    });

    const notifyComplete = new sfnTasks.LambdaInvoke(this, 'NotifyCompleteTask', {
      lambdaFunction: notifyCompleteFn,
      outputPath: '$.Payload',
    });

    const failureHandler = new sfnTasks.LambdaInvoke(this, 'FailureHandlerTask', {
      lambdaFunction: failureHandlerFn,
      outputPath: '$.Payload',
    });

    // Wire the post-choice chain (generatePlan → notifyComplete) first so the
    // Choice branches can reference these already-connected states.
    generatePlan
      .next(waitForApproval)
      .next(generateCode)
      .next(runSandbox)
      .next(deployApp)
      .next(validateDeployment)
      .next(notifyComplete);

    // Choice: if env vars required, wait then continue to generatePlan; otherwise go directly.
    const checkEnvVarsNeeded = new sfn.Choice(this, 'CheckEnvVarsNeeded')
      .when(
        sfn.Condition.booleanEquals('$.envVarsRequired', true),
        waitForEnvVars.next(generatePlan)
      )
      .otherwise(generatePlan);

    // The top-level definition starts at inspectRepo; CDK traverses all reachable states.
    const definition = sfn.Chain.start(inspectRepo.next(checkEnvVarsNeeded));

    // Add catch blocks
    const catchConfig = {
      errors: ['States.ALL'],
      resultPath: '$.error',
    };

    inspectRepo.addCatch(failureHandler, catchConfig);
    generatePlan.addCatch(failureHandler, catchConfig);
    generateCode.addCatch(failureHandler, catchConfig);
    runSandbox.addCatch(failureHandler, catchConfig);
    deployApp.addCatch(failureHandler, catchConfig);
    validateDeployment.addCatch(failureHandler, catchConfig);

    const stateMachine = new sfn.StateMachine(this, 'LazarusPipeline', {
      stateMachineName: 'lazarus-pipeline',
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.STANDARD,
      timeout: cdk.Duration.hours(2),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, 'StateMachineLogs', {
          logGroupName: '/lazarus/stepfunctions',
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // Wire state machine ARN into the lazy variable so all lambda envs pick it up
    // NOTE: STATE_MACHINE_ARN is NOT set as a Lambda env var to avoid circular dependency.
    // It is derived at runtime in backend/shared/config.ts.

    // -----------------------------------------------------------------------
    // REST API Gateway
    // -----------------------------------------------------------------------
    const cognitoAuthorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: 'lazarus-cognito-auth',
      }
    );

    const restApi = new apigateway.RestApi(this, 'LazarusAPI', {
      restApiName: 'lazarus-api',
      description: 'Lazarus REST API',
      deployOptions: {
        stageName: 'v1',
        tracingEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        throttlingBurstLimit: 50,
        throttlingRateLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://app.lazarus.dev', 'http://localhost:3000'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
        allowCredentials: true,
      },
    });

    // Add CORS headers to auth error responses so the browser can read them
    const corsResponseHeaders = {
      'Access-Control-Allow-Origin': "'http://localhost:3000'",
      'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
    };
    restApi.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      statusCode: '401',
      responseHeaders: corsResponseHeaders,
      templates: { 'application/json': '{"message":"Unauthorized — please sign in."}' },
    });
    restApi.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      statusCode: '403',
      responseHeaders: corsResponseHeaders,
      templates: { 'application/json': '{"message":"Access denied."}' },
    });
    restApi.addGatewayResponse('Default4xx', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: corsResponseHeaders,
    });

    const defaultMethodOptions: apigateway.MethodOptions = {
      authorizer: cognitoAuthorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // API Routes
    const projects = restApi.root.addResource('projects');
    projects.addMethod('POST', new apigateway.LambdaIntegration(createProjectFn), defaultMethodOptions);
    projects.addMethod('GET', new apigateway.LambdaIntegration(listProjectsFn), defaultMethodOptions);

    const project = projects.addResource('{id}');
    project.addMethod('GET', new apigateway.LambdaIntegration(getProjectFn), defaultMethodOptions);
    project.addMethod('DELETE', new apigateway.LambdaIntegration(deleteProjectFn), defaultMethodOptions);

    const plan = project.addResource('plan');
    plan.addMethod('GET', new apigateway.LambdaIntegration(getPlanFn), defaultMethodOptions);

    const approve = plan.addResource('approve');
    approve.addMethod('PUT', new apigateway.LambdaIntegration(approvePlanFn), defaultMethodOptions);

    const pr = project.addResource('pr');
    pr.addMethod('POST', new apigateway.LambdaIntegration(createPRFn), defaultMethodOptions);

    const env = project.addResource('env');
    env.addMethod('POST', new apigateway.LambdaIntegration(submitEnvVarsFn), defaultMethodOptions);

    const cost = project.addResource('cost');
    cost.addMethod('GET', new apigateway.LambdaIntegration(getCostFn), defaultMethodOptions);

    const diffs = project.addResource('diffs');
    diffs.addMethod('GET', new apigateway.LambdaIntegration(getDiffsFn), defaultMethodOptions);

    const files = project.addResource('files');
    files.addMethod('GET', new apigateway.LambdaIntegration(getFilesFn), defaultMethodOptions);

    // -----------------------------------------------------------------------
    // WebSocket API Gateway
    // -----------------------------------------------------------------------
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'LazarusWSAPI', {
      apiName: 'lazarus-ws',
      connectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          wsConnectFn
        ),
        authorizer: new apigatewayv2Authorizers.WebSocketLambdaAuthorizer(
          'WSAuth',
          wsAuthorizerFn,
          { identitySource: ['route.request.querystring.token'] }
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          wsDisconnectFn
        ),
      },
      defaultRouteOptions: {
        integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          wsMessageFn
        ),
      },
    });

    const wsStage = new apigatewayv2.WebSocketStage(this, 'WSStage', {
      webSocketApi,
      stageName: 'production',
      autoDeploy: true,
    });

    // Update environment variables with WebSocket URLs
    const wsApiUrl = `wss://${webSocketApi.apiId}.execute-api.ap-south-1.amazonaws.com/${wsStage.stageName}`;
    const wsApiEndpoint = `https://${webSocketApi.apiId}.execute-api.ap-south-1.amazonaws.com/${wsStage.stageName}`;

    // Assign lazy variables so commonEnv picks them up at synthesis time
    _wsApiUrl = wsApiUrl;
    _wsApiEndpoint = wsApiEndpoint;

    // -----------------------------------------------------------------------
    // CodeBuild Project
    // -----------------------------------------------------------------------
    const codebuildProject = new codebuild.Project(this, 'DockerBuild', {
      projectName: 'lazarus-docker-build',
      source: codebuild.Source.s3({
        bucket: codebuildBucket,
        path: 'source.zip',
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          ECR_REPO: { value: appRepo.repositoryUri },
          AWS_ACCOUNT_ID: { value: accountId },
          AWS_DEFAULT_REGION: { value: 'ap-south-1' },
        },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com',
              'IMAGE_TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
              'IMAGE_TAG=${IMAGE_TAG:-latest}',
            ],
          },
          build: {
            commands: [
              'echo Building Docker image...',
              'docker build -t $ECR_REPO:$IMAGE_TAG .',
              'docker tag $ECR_REPO:$IMAGE_TAG $ECR_REPO:latest',
            ],
          },
          post_build: {
            commands: [
              'echo Pushing Docker image...',
              'docker push $ECR_REPO:$IMAGE_TAG',
              'docker push $ECR_REPO:latest',
              'echo Build completed!',
              'echo IMAGE_URI=$ECR_REPO:$IMAGE_TAG',
            ],
          },
        },
      }),
      cache: codebuild.Cache.local(
        codebuild.LocalCacheMode.DOCKER_LAYER,
        codebuild.LocalCacheMode.SOURCE
      ),
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'CodeBuildLogs', {
            logGroupName: '/lazarus/codebuild',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
    });

    appRepo.grantPullPush(codebuildProject);
    codebuildBucket.grantRead(codebuildProject);

    // -----------------------------------------------------------------------
    // CloudFront Distribution (Overlay)
    // -----------------------------------------------------------------------
    const overlayDistribution = new cloudfront.Distribution(this, 'OverlayDistribution', {
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(overlayBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(
          this,
          'OverlayCORSPolicy',
          {
            corsBehavior: {
              accessControlAllowOrigins: ['*'],
              accessControlAllowHeaders: ['*'],
              accessControlAllowMethods: ['GET'],
              accessControlAllowCredentials: false,
              originOverride: true,
            },
          }
        ),
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      comment: 'Lazarus overlay script CDN',
    });

    // -----------------------------------------------------------------------
    // WAF
    // -----------------------------------------------------------------------
    const webAcl = new wafv2.CfnWebACL(this, 'LazarusWAF', {
      name: 'lazarus-waf',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'lazarus-waf',
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
          },
        },
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRuleSet',
          },
        },
        {
          name: 'RateLimit',
          priority: 3,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
          },
        },
      ],
    });

    // Associate WAF with API Gateway
    new wafv2.CfnWebACLAssociation(this, 'WAFAssociation', {
      webAclArn: webAcl.attrArn,
      resourceArn: restApi.deploymentStage.stageArn,
    });

    // -----------------------------------------------------------------------
    // CloudWatch Dashboard & Alarms
    // -----------------------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'LazarusDashboard', {
      dashboardName: 'LazarusOperations',
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '# Lazarus Operations Dashboard',
        width: 24,
        height: 1,
      })
    );

    // DLQ Alarm
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: 'lazarus-dlq-messages',
      metric: fileGenerationDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notificationsTopic));

    // Lambda Error Rate Alarm
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'lazarus-lambda-errors',
      metric: inspectorFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 2,
    });
    lambdaErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notificationsTopic));

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: restApi.url,
      description: 'REST API URL',
    });
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: wsApiUrl,
      description: 'WebSocket API URL',
    });
    new cdk.CfnOutput(this, 'WebSocketEndpoint', {
      value: wsApiEndpoint,
      description: 'WebSocket API Management Endpoint',
    });
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });
    new cdk.CfnOutput(this, 'ProjectsBucketName', {
      value: projectsBucket.bucketName,
      description: 'Projects S3 Bucket',
    });
    new cdk.CfnOutput(this, 'OverlayDistributionDomain', {
      value: overlayDistribution.distributionDomainName,
      description: 'Overlay CloudFront Domain',
    });
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Functions State Machine ARN',
    });
    new cdk.CfnOutput(this, 'ECSClusterArn', {
      value: ecsCluster.clusterArn,
      description: 'ECS Cluster ARN',
    });
    new cdk.CfnOutput(this, 'ECRRepoUri', {
      value: appRepo.repositoryUri,
      description: 'ECR Repository URI for deployed apps',
    });
    new cdk.CfnOutput(this, 'CodeBuildProject', {
      value: codebuildProject.projectName,
      description: 'CodeBuild Project Name',
    });
    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: `${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`,
      description: 'Redis Cluster Endpoint',
    });

    // Apply tags
    cdk.Tags.of(this).add('Project', TAGS.Project);
    cdk.Tags.of(this).add('Environment', TAGS.Environment);
  }
}
