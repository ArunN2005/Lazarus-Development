'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useProject } from '@/hooks/useProject';
import { useWebSocket } from '@/hooks/useWebSocket';
import PhaseTimeline from '@/components/PhaseTimeline';
import ProgressBar from '@/components/ProgressBar';
import HealthBadge from '@/components/HealthBadge';
import EventLog from '@/components/EventLog';
import PlanApproval from '@/components/PlanApproval';
import EnvVarsForm from '@/components/EnvVarsForm';
import api from '@/lib/api';

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { project, plan, files, cost, loading, error, refresh, refreshPlan, refreshFiles } = useProject(projectId);
  const { connected, events, lastEvent } = useWebSocket({ projectId, enabled: !!project });
  const [progress, setProgress] = useState(0);
  const [approving, setApproving] = useState(false);
  const [envSubmitting, setEnvSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'plan' | 'files' | 'logs'>('overview');

  const ACTIVE_STATUSES = new Set([
    'CREATED', 'PENDING', 'SCANNING', 'SCAN_COMPLETE',
    'PLANNING', 'AWAITING_ENV_VARS', 'AWAITING_APPROVAL',
    'BUILDING', 'TESTING', 'DEPLOYING',
  ]);
  const isActive = !!project && ACTIVE_STATUSES.has(project.status);

  // Update progress from WS events
  useEffect(() => {
    if (lastEvent?.type === 'PROGRESS') {
      setProgress(lastEvent.progress);
    }
    if (lastEvent?.type === 'PHASE_CHANGE') {
      setProgress(0);
      refresh();
    }
    if (lastEvent?.type === 'PLAN_READY') {
      refreshPlan();
    }
    if (lastEvent?.type === 'FILE_GENERATED') {
      refreshFiles();
    }
    if (lastEvent?.type === 'COMPLETED') {
      refresh();
    }
    if (lastEvent && activeTab === 'overview' && lastEvent.type !== 'COST_UPDATE') {
      // Keep overview showing live state; user can switch to logs tab if desired
    }
  }, [lastEvent]);

  const handleApprove = async () => {
    try {
      setApproving(true);
      await api.approvePlan(projectId);
      refresh();
    } catch {
      // Error handled in refresh
    } finally {
      setApproving(false);
    }
  };

  const handleEnvSubmit = async (values: Record<string, string>) => {
    try {
      setEnvSubmitting(true);
      await api.provideEnvVars(projectId, values);
      refresh();
    } catch {
      // Error handled in refresh
    } finally {
      setEnvSubmitting(false);
    }
  };

  const handleDownload = async () => {
    try {
      const { downloadUrl } = await api.downloadProject(projectId);
      window.open(downloadUrl, '_blank');
    } catch {
      // Silently fail
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin-slow text-4xl mb-4">🔮</div>
          <p className="text-gray-500">Loading project...</p>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center glass rounded-lg p-8 max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-red-400 mb-4">{error || 'Project not found'}</p>
          <Link href="/dashboard" className="text-sm text-indigo-400 hover:text-indigo-300">
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header*/}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
            <Link href="/dashboard" className="hover:text-gray-300">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-400">{project.repoName}</span>
          </div>
          <h1 className="text-xl font-bold text-white">{project.repoName}</h1>
          <p className="text-xs text-gray-600 font-mono mt-0.5">{project.repoUrl}</p>
        </div>
        <div className="flex items-center gap-3">
          {connected && (
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Live
            </span>
          )}
          {project.healthScore !== undefined && (
            <HealthBadge score={project.healthScore} size="sm" />
          )}
        </div>
      </div>

      {/* Phase Timeline */}
      <div className="glass rounded-lg p-6 mb-6">
        <PhaseTimeline currentPhase={project.phase || project.status} progress={progress} />
      </div>

      {/* FAILED error card */}
      {project.status === 'FAILED' && (
        <div className="glass rounded-lg p-5 mb-6 border border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-xl shrink-0">✗</span>
            <div>
              <h3 className="text-sm font-semibold text-red-400 mb-1">Pipeline Failed</h3>
              <p className="text-sm text-red-300/80">
                {(project as unknown as Record<string, unknown>).error as string ||
                 (project as unknown as Record<string, unknown>).failureReason as string ||
                 'An error occurred during pipeline execution.'}
              </p>
              <p className="text-xs text-gray-500 mt-2">Check the Logs tab for detailed output.</p>
            </div>
          </div>
        </div>
      )}

      {/* Always-visible live log during active phases */}
      {isActive && events.length > 0 && (
        <div className="mb-6">
          <EventLog events={events} maxHeight="260px" />
        </div>
      )}

      {/* Action area based on status */}
      {project.status === 'AWAITING_APPROVAL' && plan && (
        <div className="mb-6">
          <PlanApproval plan={plan} onApprove={handleApprove} approving={approving} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-800">
        {(['overview', 'plan', 'files', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm capitalize transition-colors border-b-2
              ${activeTab === tab
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            {tab}
            {tab === 'files' && files.length > 0 && (
              <span className="ml-1.5 text-xs text-gray-600">({files.length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status card */}
            <div className="glass rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-medium text-gray-300">Status</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Phase</span>
                  <p className="text-gray-300">{project.phase || project.status}</p>
                </div>
                <div>
                  <span className="text-gray-500">Created</span>
                  <p className="text-gray-300">{new Date(project.createdAt).toLocaleString()}</p>
                </div>
                {project.totalCost !== undefined && (
                  <div>
                    <span className="text-gray-500">Total Cost</span>
                    <p className="text-gray-300">${project.totalCost.toFixed(4)}</p>
                  </div>
                )}
                {project.deployedUrl && (
                  <div>
                    <span className="text-gray-500">Deployed URL</span>
                    <a
                      href={project.deployedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 block truncate"
                    >
                      {project.deployedUrl}
                    </a>
                  </div>
                )}
              </div>

              {project.status === 'COMPLETED' && (
                <div className="flex gap-2 pt-2">
                  <Link
                    href={`/project/${projectId}/diff`}
                    className="px-3 py-1.5 bg-gray-800 text-sm text-gray-300 rounded hover:bg-gray-700"
                  >
                    View Diffs
                  </Link>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 bg-indigo-600 text-sm text-white rounded hover:bg-indigo-500"
                  >
                    Download ZIP
                  </button>
                </div>
              )}
            </div>

            {/* Progress / Health */}
            {progress > 0 && progress < 100 && (
              <div className="glass rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Progress</h3>
                <ProgressBar progress={progress} label={project.phase || project.status} />
              </div>
            )}

            {project.healthScore !== undefined && (
              <div className="glass rounded-lg p-4 flex items-center justify-center">
                <HealthBadge score={project.healthScore} size="lg" />
              </div>
            )}

            {/* Cost summary */}
            {cost && (
              <div className="glass rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Cost</h3>
                <div className="text-2xl font-bold text-white mb-2">${cost.totalCost.toFixed(4)}</div>
                <div className="space-y-1">
                  {cost.breakdown.map((b) => (
                    <div key={b.phase} className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 capitalize">{b.phase}</span>
                      <span className="text-gray-400">${b.cost.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'plan' && plan && (
          <PlanApproval plan={plan} onApprove={handleApprove} approving={approving} />
        )}

        {activeTab === 'plan' && !plan && (
          <div className="text-center py-12 text-gray-500">
            Plan not yet generated. Waiting for Inspector to complete.
          </div>
        )}

        {activeTab === 'files' && files.length > 0 && (
          <div className="glass rounded-lg overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-800/50">
              {files.map((file) => (
                <Link
                  key={file.filePath}
                  href={`/project/${projectId}/file?path=${encodeURIComponent(file.filePath)}`}
                  className="flex items-center justify-between px-4 py-2 hover:bg-gray-800/30 transition-colors"
                >
                  <span className="text-sm text-gray-300 font-mono truncate">{file.filePath}</span>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className="text-xs text-gray-600">{file.language}</span>
                    <span className="text-xs text-gray-600">
                      {file.size > 1024 ? `${(file.size / 1024).toFixed(1)}KB` : `${file.size}B`}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'files' && files.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No files generated yet.
          </div>
        )}

        {activeTab === 'logs' && (
          <EventLog events={events} maxHeight="500px" />
        )}
      </div>
    </div>
  );
}
