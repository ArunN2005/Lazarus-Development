'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useProject } from '@/hooks/useProject';
import DiffViewer from '@/components/DiffViewer';

export default function DiffPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { project, diffs, loading } = useProject(projectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin-slow text-4xl">🔮</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <Link href="/dashboard" className="hover:text-gray-300">Dashboard</Link>
        <span>/</span>
        <Link href={`/project/${projectId}`} className="hover:text-gray-300">{project?.repoName}</Link>
        <span>/</span>
        <span className="text-gray-400">Diff</span>
      </div>

      <h1 className="text-xl font-bold text-white mb-6">File Diffs</h1>

      {diffs.length === 0 ? (
        <div className="text-center py-12 text-gray-500 glass rounded-lg">
          No diffs available yet. Code generation must complete first.
        </div>
      ) : (
        <DiffViewer diffs={diffs} />
      )}
    </div>
  );
}
