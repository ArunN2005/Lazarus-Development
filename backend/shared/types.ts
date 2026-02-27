// ============================================================================
// LAZARUS — Shared Types & Interfaces
// Complete type definitions for the entire Lazarus platform
// ============================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ProjectStatus {
  CREATED = 'created',
  SCANNING = 'scanning',
  SCAN_COMPLETE = 'scan_complete',
  AWAITING_ENV_VARS = 'awaiting_env_vars',
  ENV_VARS_RECEIVED = 'env_vars_received',
  PLANNING = 'planning',
  PLAN_READY = 'plan_ready',
  AWAITING_APPROVAL = 'awaiting_approval',
  APPROVED = 'approved',
  PLAN_APPROVED = 'plan_approved',
  GENERATING = 'generating',
  BUILDING = 'building',
  BUILD_COMPLETE = 'build_complete',
  BUILD_PARTIAL = 'build_partial',
  GENERATION_COMPLETE = 'generation_complete',
  SANDBOXING = 'sandboxing',
  SANDBOX_RUNNING = 'sandbox_running',
  SANDBOX_PASSED = 'sandbox_passed',
  SANDBOX_FAILED = 'sandbox_failed',
  DEPLOYING = 'deploying',
  DEPLOYED = 'deployed',
  DEPLOY_COMPLETE = 'deploy_complete',
  VALIDATING = 'validating',
  DEGRADED = 'degraded',
  COMPLETE = 'complete',
  FAILED = 'failed',
  NEEDS_MANUAL_FIX = 'needs_manual_fix',
  HEALING = 'healing',
}

export enum PhaseNumber {
  INSPECT = 1,
  ARCHITECT = 2,
  BUILD = 3,
  SANDBOX = 4,
  DEPLOY = 5,
  VALIDATE = 6,
}

export enum FileAction {
  MODIFY = 'modify',
  COPY = 'copy',
  DELETE = 'delete',
  CREATE = 'create',
  MIGRATE = 'migrate',
  RENAME = 'rename',
}

export type MigrationBatch = 1 | 2 | 3 | 4;

export enum ErrorCategory {
  MISSING_PACKAGE = 'MISSING_PACKAGE',
  VERSION_CONFLICT = 'VERSION_CONFLICT',
  NATIVE_MODULE = 'NATIVE_MODULE',
  TYPESCRIPT_ERROR = 'TYPESCRIPT_ERROR',
  SYNTAX_ERROR = 'SYNTAX_ERROR',
  IMPORT_ERROR = 'IMPORT_ERROR',
  EXPORT_ERROR = 'EXPORT_ERROR',
  JSX_ERROR = 'JSX_ERROR',
  REACT_HOOK_ERROR = 'REACT_HOOK_ERROR',
  CSS_ERROR = 'CSS_ERROR',
  ESLINT_ERROR = 'ESLINT_ERROR',
  WEBPACK_ERROR = 'WEBPACK_ERROR',
  VITE_ERROR = 'VITE_ERROR',
  NEXT_CONFIG_ERROR = 'NEXT_CONFIG_ERROR',
  PORT_CONFLICT = 'PORT_CONFLICT',
  PORT_NOT_EXPOSED = 'PORT_NOT_EXPOSED',
  ENV_MISSING = 'ENV_MISSING',
  DB_CONNECTION = 'DB_CONNECTION',
  ASYNC_ERROR = 'ASYNC_ERROR',
  BUILD_COMMAND_MISSING = 'BUILD_COMMAND_MISSING',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  MEMORY_ERROR = 'MEMORY_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export enum FixStrategy {
  DETERMINISTIC = 'deterministic',
  AI_SURGICAL = 'ai_surgical',
  USER_INPUT = 'user_input',
  FULL_REGEN = 'full_regen',
  INSTALL_PACKAGE = 'install_package',
  FIX_VERSION = 'fix_version',
  ADD_TYPE_PACKAGE = 'add_type_package',
  FIX_IMPORT = 'fix_import',
  ADD_ENV_VAR = 'add_env_var',
  FIX_PORT = 'fix_port',
  FIX_CONFIG = 'fix_config',
}

export enum WebSocketEventType {
  // Phase lifecycle
  PHASE_STARTED = 'phase_started',
  PHASE_COMPLETE = 'phase_complete',
  PHASE_FAILED = 'phase_failed',

  // Inspector
  SCAN_PROGRESS = 'scan_progress',
  TECH_STACK_DETECTED = 'tech_stack_detected',

  // Architect
  PLAN_READY = 'plan_ready',
  PLAN_UPDATED = 'plan_updated',

  // Builder
  FILE_GENERATION_STARTED = 'file_generation_started',
  FILE_GENERATION_CHUNK = 'file_generation_chunk',
  FILE_GENERATION_COMPLETE = 'file_generation_complete',
  FILE_GENERATION_FAILED = 'file_generation_failed',
  FILE_GENERATION_PROGRESS = 'file_generation_progress',

  // Sandbox
  SANDBOX_ITERATION = 'sandbox_iteration',
  SANDBOX_FIXING = 'sandbox_fixing',
  SANDBOX_FIX = 'sandbox_fix',
  SANDBOX_PASSED = 'sandbox_passed',
  SANDBOX_FAILED = 'sandbox_failed',
  CONTAINER_LOG = 'container_log',
  ENV_REQUIRED = 'env_required',

  // Builder
  BUILD_PHASE = 'build_phase',
  BUILD_PROGRESS = 'build_progress',
  FILE_GENERATED = 'file_generated',
  FILE_FAILED = 'file_failed',

  // Deployer
  BUILD_LOG = 'build_log',
  DEPLOY_PROGRESS = 'deploy_progress',
  DEPLOY_COMPLETE = 'deploy_complete',

  // Validator
  HEALTH_CHECK = 'health_check',
  VALIDATION_HEAL = 'validation_heal',
  RESURRECTION_COMPLETE = 'resurrection_complete',
  HEAL_EXHAUSTED = 'heal_exhausted',
  PROJECT_COMPLETE = 'project_complete',

  // Cost
  COST_UPDATE = 'cost_update',

  // Error
  ERROR = 'error',

  // Design Mode
  DESIGN_CSS_APPLIED = 'design_css_applied',
  DESIGN_COMPONENT_REWRITTEN = 'design_component_rewritten',
}

export enum EnvVarClassification {
  SECRET = 'SECRET',
  CONFIG = 'CONFIG',
  OPTIONAL = 'OPTIONAL',
  BUILD = 'BUILD',
  PUBLIC = 'PUBLIC',
}

// ---------------------------------------------------------------------------
// Core Interfaces
// ---------------------------------------------------------------------------

export interface TechStack {
  language: string;
  languageVersion: string;
  framework: string;
  frameworkVersion: string;
  targetFramework: string;
  targetFrameworkVersion: string;
  buildTool: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'pip' | 'maven' | 'gradle' | 'bundler' | 'bun';
  testFramework: string | null;
  cssFramework: string | null;
  stateManagement: string | null;
  router: string | null;
  database: string | null;
  orm: string | null;
  apiStyle: 'REST' | 'GraphQL' | 'gRPC' | 'WebSocket' | 'tRPC' | null;
  containerized: boolean;
  monorepo: boolean;
  hasTypeScript: boolean;
  hasDocker: boolean;
  hasCICD: boolean;
  entryPoint: string;
  sourceDirectory: string;
  outputDirectory: string;
  port: number;
  // Extended detection properties
  runtime?: string;
  styling?: string | null;
  testing?: string | null;
  deployment?: string | null;
  cicd?: string | null;
  ssr?: boolean;
  pwa?: boolean;
}

export interface MigrationPlanFile {
  filePath: string;
  action: FileAction;
  sourceFilePath: string | null;
  batch: MigrationBatch;
  priority: number;
  dependencies: string[];
  currentPatterns: string[];
  modernPatterns: string[];
  reasoning: string;
  breakingChanges: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  estimatedTokens: number;
  requiresHumanReview: boolean;
  testRequired: boolean;
  // Aliases/extended properties used by agents
  targetPath?: string;
  sourcePath?: string | null;
  phase?: number;
  description?: string;
  migrationNotes?: string | null;
  isConfig?: boolean;
  isEntryPoint?: boolean;
  isTest?: boolean;
  complexity?: 'low' | 'medium' | 'high';
}

export interface MigrationPlan {
  projectId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  totalFiles: number;
  batches: {
    batch1: number;
    batch2: number;
    batch3: number;
    batch4: number;
  };
  estimatedTotalTokens: number;
  estimatedCost: number;
  files: MigrationPlanFile[];
  userEdits: number;
  // Extended properties used by agents
  phases?: Record<string, unknown>;
  summary?: string;
  targetStack?: string | TechStack;
  sourceStack?: string | TechStack;
}

export interface SandboxIteration {
  projectId: string;
  iterationNumber: number;
  step: 'install' | 'build' | 'start' | 'healthcheck';
  success: boolean;
  errorCategory: ErrorCategory | null;
  errorMessage: string | null;
  affectedFile: string | null;
  fixStrategy: FixStrategy | null;
  fixApplied: string | null;
  patchedFiles: string[];
  healthScore: number | null;
  durationMs: number;
  tokensUsed: number;
  cost: number;
  timestamp: string;
  logs: string[];
  // Extended properties used by sandbox agent
  iteration?: number;
  installSuccess?: boolean;
  buildSuccess?: boolean;
  startSuccess?: boolean;
  healthCheckPassed?: boolean;
  errors?: ClassifiedError[];
  fixesApplied?: string[];
  startedAt?: string;
  completedAt?: string | null;
}

export interface ClassifiedError {
  category: ErrorCategory;
  confidence: number;
  rawMessage: string;
  affectedFile: string | null;
  lineNumber: number | null;
  severity: number;
  fixStrategy: FixStrategy;
  // Convenience aliases used by agents
  message?: string;
  file?: string | null;
  line?: number | null;
}

export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  projectId: string;
  timestamp: string;
  payload: T;
}

export interface FileDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  reasoning: string | null;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface FileDiff {
  filePath?: string;
  action?: FileAction;
  hunks: FileDiffHunk[] | DiffHunkCompat[];
  addedLines?: number;
  removedLines?: number;
  modifiedLines?: number;
  originalSize?: number;
  generatedSize?: number;
  // Extended properties from diffComputer
  originalPath?: string;
  generatedPath?: string;
  additions?: number;
  deletions?: number;
  isBinary?: boolean;
}

/** Compat type for diffComputer DiffHunk */
export interface DiffHunkCompat {
  originalStart: number;
  originalLength: number;
  generatedStart: number;
  generatedLength: number;
  changes: Array<{ type: string; content: string; lineNumber: number }>;
}

export interface Project {
  projectId: string;
  userId: string;
  githubUrl: string;
  repoName: string;
  repoOwner: string;
  isPrivate: boolean;
  status: ProjectStatus;
  currentPhase: PhaseNumber;
  techStack: TechStack | null;
  fileCount: number;
  textFileCount: number;
  binaryFileCount: number;
  analysisComplete: boolean;
  planApprovalToken: string | null;
  envVarsToken: string | null;
  envVarsRequired: ClassifiedEnvVar[];
  envVarsProvided: boolean;
  migrationPlanVersion: number;
  generatedFileCount: number;
  totalFilesToGenerate: number;
  sandboxIterations: number;
  sandboxHealthScore: number | null;
  liveUrl: string | null;
  serviceArn: string | null;
  ecrImageUri: string | null;
  healthScore: number | null;
  cost: number;
  stepFunctionExecutionArn: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  userEdits: number;
  planApprovedAt: string | null;
}

export interface FileGeneration {
  projectId: string;
  filePath: string;
  action: FileAction;
  batch: MigrationBatch;
  status: 'pending' | 'generating' | 'complete' | 'failed' | 'retrying';
  attempt: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  generationTimeMs: number;
  cost: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CostEntry {
  projectId: string;
  timestamp: string;
  service: 'bedrock_sonnet' | 'bedrock_haiku' | 'bedrock_opus' | 'codebuild' | 'ecs_fargate' | 'app_runner' | 'other';
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  metadata: Record<string, string>;
}

export interface HealLog {
  projectId: string;
  timestamp: string;
  phase: 'sandbox' | 'post_deploy';
  iteration: number;
  errorCategory: ErrorCategory;
  errorMessage: string;
  affectedFile: string | null;
  fixStrategy: FixStrategy;
  fixApplied: string;
  success: boolean;
  tokensUsed: number;
  cost: number;
  durationMs: number;
}

export interface ClassifiedEnvVar {
  name: string;
  classification: EnvVarClassification;
  description: string;
  exampleValue: string;
  required: boolean;
  // Extended properties used by env extractor
  usedInFiles?: string[];
  hasDefault?: boolean;
  defaultValue?: string | null;
  suggestedValue?: string | null;
}

// ---------------------------------------------------------------------------
// Analysis Interfaces (Inspector)
// ---------------------------------------------------------------------------

export interface ImportInfo {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isDynamic: boolean;
  // Extended properties
  names?: string[];
  isNamespace?: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  type: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'const' | 'unknown';
  isType?: boolean;
}

export interface RouteInfo {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL' | 'USE';
  path: string;
  handler: string | null;
}

export interface FunctionInfo {
  name: string;
  params: string[];
  isAsync: boolean;
  isExported: boolean;
  lineNumber: number;
}

export interface ClassInfo {
  name: string;
  extends: string | null;
  implements: string[];
  methods: string[];
  isExported: boolean;
}

export interface ModelInfo {
  name: string;
  fields: Record<string, string>;
  source: 'mongoose' | 'sequelize' | 'prisma' | 'typeorm' | 'knex' | 'unknown';
}

export interface ComponentInfo {
  name: string;
  type: 'function' | 'class' | 'arrow';
  props: string[];
  hooks: string[];
  isExported: boolean;
}

export interface FileAnalysis {
  filePath: string;
  language: string;
  extension: string;
  sizeBytes: number;
  lineCount: number;
  imports: ImportInfo[];
  exports: ExportInfo[];
  routes: RouteInfo[];
  functions: FunctionInfo[];
  classes: ClassInfo[] | string[];
  models: ModelInfo[];
  components: ComponentInfo[];
  envVars: string[];
  hooks: string[];
  hasJSX: boolean;
  isEntryPoint: boolean;
  isConfig: boolean;
  isTest: boolean;
  // Extended properties used by inspector agents
  envVarRefs?: string[];
  complexity?: string | number | null;
  hasDefaultExport?: boolean;
  framework?: string | null;
  dependencies?: string[];
}

export interface StackDetectionResult {
  techStack: TechStack;
  confidence: number;
  alternativeFrameworks: string[];
  warnings: string[];
}

export interface ProjectAnalysis {
  projectId: string;
  githubUrl: string;
  repoName: string;
  repoOwner: string;
  isPrivate: boolean;
  techStack: TechStack;
  files: FileAnalysis[];
  totalFiles: number;
  textFiles: number;
  binaryFiles: number;
  totalLines: number;
  envVars: ClassifiedEnvVar[];
  dependencyGraph: Record<string, string[]>;
  circularDependencies: string[][];
  entryPoints: string[];
  configFiles: string[];
  testFiles: string[];
}

// ---------------------------------------------------------------------------
// Agent Result Interfaces
// ---------------------------------------------------------------------------

export interface BuildResult {
  projectId: string;
  totalFiles: number;
  generatedFiles: number;
  failedFiles: number;
  totalTokensUsed: number;
  totalCost: number;
  importReconciliation: ReconciliationResult;
  durationMs: number;
}

export interface ReconciliationResult {
  filesFixed: number;
  totalBrokenImports: number;
  unfixableImports: string[];
}

export interface SandboxResult {
  projectId: string;
  success: boolean;
  iterations: number;
  finalHealthScore: number;
  errors: ClassifiedError[];
  fixesApplied: SandboxFixRecord[];
  totalCost: number;
  durationMs: number;
  // Extended properties
  healthy?: boolean;
  lastErrors?: ClassifiedError[];
  allIterations?: SandboxIteration[];
}

export interface SandboxFixRecord {
  iteration: number;
  errorCategory: ErrorCategory;
  fixStrategy: FixStrategy;
  patchedFiles: string[];
  success: boolean;
}

export interface DeployResult {
  projectId: string;
  liveUrl: string;
  serviceArn: string;
  ecrImageUri: string;
  buildDurationMs: number;
  deployDurationMs: number;
  totalDurationMs: number;
  cost: number;
  // Extended properties
  imageUri?: string;
  success?: boolean;
}

export interface ValidationResult {
  projectId: string;
  healthScore: number;
  routeResults: RouteCheckResult[];
  logErrors: LogError[] | ClassifiedError[];
  traceIssues: TraceIssue[];
  passed: boolean;
  healAttempt: number;
  // Extended properties
  liveUrl?: string;
  totalCost?: number;
  healthChecks?: RouteCheckResult[] | Record<string, unknown>[];
  endpointResults?: RouteCheckResult[] | Record<string, unknown>[];
  needsHeal?: boolean;
  success?: boolean;
}

export interface RouteCheckResult {
  route: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  passed: boolean;
  error: string | null;
}

export interface LogError {
  message: string;
  category: ErrorCategory;
  severity: number;
  timestamp: string;
}

export interface TraceIssue {
  traceId: string;
  url: string;
  latencyMs: number;
  fault: boolean;
  error: boolean;
  description: string;
}

// ---------------------------------------------------------------------------
// Generation Context (Builder)
// ---------------------------------------------------------------------------

export interface GenerationContext {
  projectId: string;
  filePath?: string;
  planEntry?: MigrationPlanFile;
  originalContent?: string | null;
  dependencyContents?: Record<string, string>;
  batch1Context?: Batch1Context;
  techStack: TechStack;
  // Extended properties used by builder agent
  plan?: MigrationPlan;
  originalFiles?: Map<string, string>;
  generatedFiles?: Map<string, string>;
}

export interface Batch1Context {
  packageJson: string | null;
  tsconfigJson: string | null;
  schemaContent: string | null;
  envExample: string | null;
}

// ---------------------------------------------------------------------------
// WebSocket Connection
// ---------------------------------------------------------------------------

export interface WSConnection {
  connectionId: string;
  projectId: string;
  userId: string;
  connectedAt: string;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Design Mode
// ---------------------------------------------------------------------------

export interface ElementContext {
  tagName: string;
  lazarusId: string;
  className: string;
  textContent: string;
  computedStyles: Record<string, string>;
  boundingRect: { top: number; left: number; width: number; height: number };
  reactComponentName: string | null;
  filePath: string | null;
}

export interface CSSChange {
  property: string;
  oldValue: string;
  newValue: string;
}

export interface DesignChange {
  elementId: string;
  changeType: 'instant_css' | 'component_rewrite';
  cssChanges?: CSSChange[];
  newComponentCode?: string;
  prompt: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Search (MCP)
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  relevance: number;
}

export interface SearchRequest {
  queries: string[];
  maxResultsPerQuery: number;
  tokenBudget: number;
}

export interface SearchResponse {
  results: SearchResult[];
  totalTokensUsed: number;
}

// ---------------------------------------------------------------------------
// API Request/Response Types
// ---------------------------------------------------------------------------

export interface CreateProjectRequest {
  githubUrl: string;
  pat?: string;
  selectedSubProject?: string;
}

export interface CreateProjectResponse {
  projectId: string;
  status: ProjectStatus;
  wsUrl: string;
}

export interface ApprovePlanRequest {
  edits?: MigrationPlanFile[];
}

export interface SubmitEnvVarsRequest {
  vars: Record<string, string>;
}

export interface CreatePRRequest {
  targetBranch?: string;
  title?: string;
  description?: string;
}

export interface ErrorResponse {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Config Interface
// ---------------------------------------------------------------------------

export interface LazarusConfig {
  region: string;
  accountId: string;
  projectsBucket: string;
  codebuildBucket: string;
  overlayBucket: string;
  projectsTable: string;
  migrationPlansTable: string;
  fileGenerationsTable: string;
  sandboxIterationsTable: string;
  healLogsTable: string;
  costTrackingTable: string;
  userProjectsTable: string;
  wsConnectionsTable: string;
  fileGenerationQueueUrl: string;
  fileGenerationDlqUrl: string;
  redisUrl: string;
  wsApiUrl: string;
  wsApiEndpoint: string;
  ecsClusterArn: string;
  githubMcpTaskDef: string;
  websearchMcpTaskDef: string;
  sandboxTaskDef: string;
  codebuildProject: string;
  codeBuildProject?: string;
  configBucket: string;
  appRunnerAccessRoleArn: string;
  ecrRepoUri: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoIssuer: string;
  snsTopicArn: string;
  vpcSubnets: string;
  securityGroup: string;
  stateMachineArn: string;
  overlayDomain: string;
}

// ---------------------------------------------------------------------------
// Manifest (GitHub MCP)
// ---------------------------------------------------------------------------

export interface CloneManifest {
  totalFiles: number;
  textFiles: number;
  binaryFiles: number;
  fileList: string[];
  timestamp: string;
  sparseCheckout: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Fix Engine Types
// ---------------------------------------------------------------------------

export interface FixResult {
  rerunFrom: 'install' | 'build' | 'start' | 'healthcheck';
  patchedFiles: string[];
  fixDescription: string;
  tokensUsed: number;
  cost: number;
}

export interface Regression {
  regressing: boolean;
  category: ErrorCategory;
  file: string;
  consecutiveCount: number;
}

export interface AISurgicalFixResponse {
  diagnosis: string;
  fix: string;
  patches: Array<{
    filePath: string;
    newContent: string;
  }>;
}

// ---------------------------------------------------------------------------
// Phase Status (Frontend)
// ---------------------------------------------------------------------------

export interface PhaseStatus {
  phase: PhaseNumber;
  name: string;
  status: 'pending' | 'active' | 'complete' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

export interface CostBreakdown {
  total: number;
  bedrockSonnet: number;
  bedrockHaiku: number;
  codebuild: number;
  ecsFargate: number;
  appRunner: number;
  other: number;
}

// ---------------------------------------------------------------------------
// Runner Types (Sandbox)
// ---------------------------------------------------------------------------

export interface RunResult {
  success: boolean;
  logs: string[];
  exitCode: number | null;
  durationMs: number;
}

export interface HealthCheckResult extends RunResult {
  healthScore: number;
  passingRoutes: string[];
  failingRoutes: string[];
}

export interface IterationHistory {
  iteration: number;
  step: string;
  errorCategory: ErrorCategory | null;
  affectedFile: string | null;
  fixStrategy: FixStrategy | null;
  success: boolean;
}
