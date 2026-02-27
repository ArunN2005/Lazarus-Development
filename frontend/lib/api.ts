'use client';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

function getStoredToken(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const expires = Number(localStorage.getItem('lazarus_token_expires') || 0);
  if (Date.now() > expires) return undefined;
  // API Gateway CognitoUserPoolsAuthorizer validates the id_token (has aud = clientId),
  // NOT the access_token (which has client_id but no aud claim).
  return localStorage.getItem('lazarus_id_token') ?? undefined;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
}

class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public handler?: string,
    public timestamp?: string,
  ) {
    super(message);
    this.name = 'APIError';
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, token } = options;

  const finalHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const authToken = token || getStoredToken();
  if (!authToken) {
    // No token — redirect to login instead of hitting a CORS-blocked 401
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new APIError(401, 'Not authenticated — please sign in.');
  }
  finalHeaders['Authorization'] = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new APIError(0, 'Network error — check your connection.');
  }

  if (response.status === 401) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new APIError(401, 'Session expired — please sign in again.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new APIError(
      response.status,
      error.message || error.error || 'Request failed',
      error.code,
      error.handler,
      error.timestamp,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

// Project APIs
export interface Project {
  projectId: string;
  userId: string;
  repoUrl: string;
  repoName: string;
  status: string;
  phase: string;
  healthScore?: number;
  deployedUrl?: string;
  createdAt: string;
  updatedAt: string;
  totalCost?: number;
  error?: string;
}

export interface MigrationPlan {
  projectId: string;
  version: number;
  targetStack: Record<string, string>;
  phases: PlanPhase[];
  totalFiles: number;
  estimatedTokens: number;
  estimatedCost: number;
  status: string;
}

export interface PlanPhase {
  phase: number;
  name: string;
  files: PlanFile[];
  dependencies: string[];
}

export interface PlanFile {
  path: string;
  action: 'MIGRATE' | 'CREATE' | 'DELETE' | 'RENAME' | 'COPY';
  description: string;
  estimatedTokens: number;
  dependencies: string[];
  newPath?: string;
}

export interface GeneratedFile {
  filePath: string;
  status: string;
  size: number;
  language: string;
}

export interface FileDiff {
  filePath: string;
  oldPath?: string;
  action: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'add' | 'del' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface CostBreakdownData {
  projectId: string;
  totalCost: number;
  breakdown: {
    phase: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    model: string;
  }[];
}

export interface EnvVar {
  name: string;
  classification: 'SECRET' | 'BUILD' | 'PUBLIC';
  description?: string;
  value?: string;
}

// API Functions
export const api = {
  // Projects
  createProject: (data: { repoUrl: string; githubPat?: string }, token?: string) =>
    request<{ projectId: string; executionArn: string }>('/projects', {
      method: 'POST',
      body: { githubUrl: data.repoUrl, pat: data.githubPat },
      token,
    }),

  listProjects: (token?: string) =>
    request<{ projects: Project[] }>('/projects', { token }),

  getProject: (projectId: string, token?: string) =>
    request<{ project: Project }>(`/projects/${projectId}`, { token }),

  // Plan
  getPlan: (projectId: string, token?: string) =>
    request<{ plan: MigrationPlan }>(`/projects/${projectId}/plan`, { token }),

  approvePlan: (projectId: string, token?: string) =>
    request<{ message: string }>(`/projects/${projectId}/plan/approve`, {
      method: 'POST',
      token,
    }),

  // Env vars
  provideEnvVars: (projectId: string, envVars: Record<string, string>, token?: string) =>
    request<{ message: string }>(`/projects/${projectId}/env`, {
      method: 'POST',
      body: { envVars },
      token,
    }),

  // Files
  listFiles: (projectId: string, token?: string) =>
    request<{ files: GeneratedFile[] }>(`/projects/${projectId}/files`, { token }),

  getFileContent: (projectId: string, filePath: string, token?: string) =>
    request<{ content: string; language: string }>(
      `/projects/${projectId}/files/${encodeURIComponent(filePath)}`,
      { token }
    ),

  updateFileContent: (
    projectId: string,
    filePath: string,
    content: string,
    token?: string
  ) =>
    request<{ message: string }>(
      `/projects/${projectId}/files/${encodeURIComponent(filePath)}`,
      { method: 'PUT', body: { content }, token }
    ),

  // Cost
  getCost: (projectId: string, token?: string) =>
    request<CostBreakdownData>(`/projects/${projectId}/cost`, { token }),

  // Diff
  getDiff: (projectId: string, token?: string) =>
    request<{ diffs: FileDiff[] }>(`/projects/${projectId}/diff`, { token }),

  // Download
  downloadProject: (projectId: string, token?: string) =>
    request<{ downloadUrl: string }>(`/projects/${projectId}/download`, { token }),
};

export { APIError };
export default api;
