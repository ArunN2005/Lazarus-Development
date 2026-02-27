'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api, { Project } from '@/lib/api';
import HealthBadge from '@/components/HealthBadge';

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  INSPECTING: { label: 'Inspecting', color: 'text-blue-400' },
  PLANNING: { label: 'Planning', color: 'text-purple-400' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', color: 'text-amber-400' },
  BUILDING: { label: 'Building', color: 'text-indigo-400' },
  TESTING: { label: 'Testing', color: 'text-cyan-400' },
  DEPLOYING: { label: 'Deploying', color: 'text-rose-400' },
  VALIDATING: { label: 'Validating', color: 'text-teal-400' },
  COMPLETED: { label: 'Completed', color: 'text-green-400' },
  FAILED: { label: 'Failed', color: 'text-red-400' },
};

export default function DashboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      setLoading(true);
      const { projects: p } = await api.listProjects();
      setProjects(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin-slow text-4xl mb-4">🔮</div>
          <p className="text-gray-500">Loading projects...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center glass rounded-lg p-8 max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={loadProjects}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} migration{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/new"
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium
            hover:bg-indigo-500 transition-colors flex items-center gap-2"
        >
          <span>+</span> New Migration
        </Link>
      </div>

      {/* Project list */}
      {projects.length === 0 ? (
        <div className="text-center glass rounded-lg p-12">
          <div className="text-5xl mb-4">🏗️</div>
          <h2 className="text-lg font-medium text-white mb-2">No projects yet</h2>
          <p className="text-sm text-gray-500 mb-6">
            Start your first migration by providing a GitHub repository URL.
          </p>
          <Link
            href="/new"
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-500"
          >
            Start Migration →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => {
            const status = STATUS_STYLES[project.status] || { label: project.status, color: 'text-gray-400' };
            return (
              <Link
                key={project.projectId}
                href={`/project/${project.projectId}`}
                className="glass rounded-lg p-4 hover:border-indigo-500/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-medium text-white group-hover:text-indigo-300 transition-colors truncate">
                        {project.repoName}
                      </h3>
                      <span className={`text-xs font-medium ${status.color}`}>{status.label}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1 truncate">{project.repoUrl}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                      {project.totalCost !== undefined && (
                        <span>Cost: ${project.totalCost.toFixed(4)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 ml-4">
                    {project.healthScore !== undefined && (
                      <HealthBadge score={project.healthScore} size="sm" showLabel={false} />
                    )}
                    {project.deployedUrl && (
                      <span className="text-xs text-green-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        Live
                      </span>
                    )}
                    <span className="text-gray-600 group-hover:text-gray-400">→</span>
                  </div>
                </div>

                {project.error && (
                  <div className="mt-2 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                    {project.error}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
