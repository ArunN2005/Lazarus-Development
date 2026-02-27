'use client';

import { FileDiff, DiffHunk, DiffChange } from '@/lib/api';

interface DiffViewerProps {
  diffs: FileDiff[];
  selectedFile?: string;
}

function DiffStats({ diff }: { diff: FileDiff }) {
  return (
    <span className="text-xs">
      <span className="text-green-400">+{diff.additions}</span>
      {' '}
      <span className="text-red-400">-{diff.deletions}</span>
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    MIGRATE: 'bg-blue-500/20 text-blue-400',
    CREATE: 'bg-green-500/20 text-green-400',
    DELETE: 'bg-red-500/20 text-red-400',
    RENAME: 'bg-yellow-500/20 text-yellow-400',
    COPY: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[action] || colors.COPY}`}>
      {action}
    </span>
  );
}

function HunkView({ hunk }: { hunk: DiffHunk }) {
  return (
    <div className="border-t border-gray-800">
      <div className="px-4 py-1 bg-gray-900/50 text-xs text-gray-500 font-mono">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      <div className="font-mono text-xs">
        {hunk.changes.map((change, i) => (
          <ChangeLineView key={i} change={change} />
        ))}
      </div>
    </div>
  );
}

function ChangeLineView({ change }: { change: DiffChange }) {
  const bgColor = {
    add: 'bg-green-900/20',
    del: 'bg-red-900/20',
    context: '',
  }[change.type];

  const textColor = {
    add: 'text-green-300',
    del: 'text-red-300',
    context: 'text-gray-400',
  }[change.type];

  const prefix = { add: '+', del: '-', context: ' ' }[change.type];

  return (
    <div className={`flex ${bgColor} hover:brightness-125 transition-all`}>
      <span className="w-12 text-right pr-2 text-gray-600 select-none shrink-0 border-r border-gray-800">
        {change.oldLine || ''}
      </span>
      <span className="w-12 text-right pr-2 text-gray-600 select-none shrink-0 border-r border-gray-800">
        {change.newLine || ''}
      </span>
      <span className={`px-1 select-none ${textColor}`}>{prefix}</span>
      <span className={`flex-1 ${textColor} whitespace-pre`}>{change.content}</span>
    </div>
  );
}

export default function DiffViewer({ diffs, selectedFile }: DiffViewerProps) {
  const displayDiffs = selectedFile
    ? diffs.filter((d) => d.filePath === selectedFile)
    : diffs;

  if (displayDiffs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No diffs to display
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <span>{displayDiffs.length} file{displayDiffs.length !== 1 ? 's' : ''} changed</span>
        <span className="text-green-400">
          +{displayDiffs.reduce((s, d) => s + d.additions, 0)}
        </span>
        <span className="text-red-400">
          -{displayDiffs.reduce((s, d) => s + d.deletions, 0)}
        </span>
      </div>

      {/* File diffs */}
      {displayDiffs.map((diff) => (
        <div key={diff.filePath} className="border border-gray-800 rounded-lg overflow-hidden">
          {/* File header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/50 border-b border-gray-800">
            <ActionBadge action={diff.action} />
            <span className="text-sm text-gray-300 font-mono truncate">
              {diff.oldPath && diff.oldPath !== diff.filePath
                ? `${diff.oldPath} → ${diff.filePath}`
                : diff.filePath}
            </span>
            <div className="ml-auto">
              <DiffStats diff={diff} />
            </div>
          </div>

          {/* Hunks */}
          {diff.hunks.map((hunk, i) => (
            <HunkView key={i} hunk={hunk} />
          ))}
        </div>
      ))}
    </div>
  );
}
