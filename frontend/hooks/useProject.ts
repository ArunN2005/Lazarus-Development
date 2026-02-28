'use client';

import { useState, useEffect, useCallback } from 'react';
import api, { Project, MigrationPlan, GeneratedFile, CostBreakdownData, FileDiff } from '@/lib/api';

interface UseProjectReturn {
  project: Project | null;
  plan: MigrationPlan | null;
  files: GeneratedFile[];
  cost: CostBreakdownData | null;
  diffs: FileDiff[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshPlan: () => Promise<void>;
  refreshFiles: () => Promise<void>;
  refreshCost: () => Promise<void>;
  refreshDiffs: () => Promise<void>;
}

export function useProject(projectId: string): UseProjectReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [cost, setCost] = useState<CostBreakdownData | null>(null);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const { project: p } = await api.getProject(projectId);
      setProject(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const refreshPlan = useCallback(async () => {
    try {
      const { plan: p } = await api.getPlan(projectId);
      setPlan(p);
    } catch {
      // Plan may not exist yet
    }
  }, [projectId]);

  const refreshFiles = useCallback(async () => {
    try {
      const { files: f } = await api.listFiles(projectId);
      setFiles(f);
    } catch {
      // Files may not exist yet
    }
  }, [projectId]);

  const refreshCost = useCallback(async () => {
    try {
      const c = await api.getCost(projectId);
      setCost(c);
    } catch {
      // Cost data may not exist yet
    }
  }, [projectId]);

  const refreshDiffs = useCallback(async () => {
    try {
      const { diffs: d } = await api.getDiff(projectId);
      setDiffs(d);
    } catch {
      // Diffs may not exist yet
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-refresh based on project status
  useEffect(() => {
    if (!project) return;

    const status = project.status;

    if (status === 'AWAITING_APPROVAL' || status === 'PLANNING') {
      refreshPlan();
    }
    if (status === 'BUILDING' || status === 'TESTING' || status === 'DEPLOYING' || status === 'COMPLETED' || status === 'FAILED') {
      refreshFiles();
      refreshCost();
    }
    if (status === 'COMPLETED') {
      refreshDiffs();
    }
  }, [project?.status]);

  // Poll while project is in an active non-terminal state
  useEffect(() => {
    const ACTIVE_STATUSES = new Set([
      'CREATED', 'PENDING', 'SCANNING', 'SCAN_COMPLETE',
      'PLANNING', 'AWAITING_ENV_VARS', 'AWAITING_APPROVAL',
      'BUILDING', 'TESTING', 'DEPLOYING',
    ]);

    if (!project || !ACTIVE_STATUSES.has(project.status)) return;

    const id = setInterval(() => {
      refresh();
    }, 5000);

    return () => clearInterval(id);
  }, [project?.status, refresh]);

  return {
    project,
    plan,
    files,
    cost,
    diffs,
    loading,
    error,
    refresh,
    refreshPlan,
    refreshFiles,
    refreshCost,
    refreshDiffs,
  };
}
