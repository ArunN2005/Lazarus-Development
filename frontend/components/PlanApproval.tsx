'use client';

import { MigrationPlan } from '@/lib/api';

interface PlanApprovalProps {
  plan: MigrationPlan;
  onApprove: () => void;
  approving?: boolean;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

const ACTION_COLORS: Record<string, string> = {
  MIGRATE: 'text-blue-400',
  CREATE: 'text-green-400',
  DELETE: 'text-red-400',
  RENAME: 'text-yellow-400',
  COPY: 'text-gray-400',
};

export default function PlanApproval({ plan, onApprove, approving }: PlanApprovalProps) {
  const actionCounts = plan.phases.reduce(
    (acc, phase) => {
      phase.files.forEach((f) => {
        acc[f.action] = (acc[f.action] || 0) + 1;
      });
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{plan.phases.length}</div>
          <div className="text-xs text-gray-500">Phases</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{plan.totalFiles}</div>
          <div className="text-xs text-gray-500">Files</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">{formatTokens(plan.estimatedTokens)}</div>
          <div className="text-xs text-gray-500">Est. Tokens</div>
        </div>
        <div className="glass rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-indigo-400">{formatCost(plan.estimatedCost)}</div>
          <div className="text-xs text-gray-500">Est. Cost</div>
        </div>
      </div>

      {/* Action summary */}
      <div className="flex items-center gap-4 text-sm">
        {Object.entries(actionCounts).map(([action, count]) => (
          <span key={action} className={`${ACTION_COLORS[action] || 'text-gray-400'}`}>
            {count} {action.toLowerCase()}
          </span>
        ))}
      </div>

      {/* Target stack */}
      {plan.targetStack && Object.keys(plan.targetStack).length > 0 && (
        <div className="glass rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">Target Stack</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(plan.targetStack).map(([key, value]) => (
              <span
                key={key}
                className="px-2 py-1 bg-gray-800 rounded text-xs text-gray-300"
              >
                {key}: <span className="text-indigo-400">{value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Phases */}
      <div className="space-y-4">
        {plan.phases.map((phase) => (
          <div key={phase.phase} className="glass rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-xs text-white font-bold">
                  {phase.phase}
                </span>
                <span className="text-sm font-medium text-gray-200">{phase.name}</span>
              </div>
              <span className="text-xs text-gray-500">{phase.files.length} files</span>
            </div>

            {phase.dependencies?.length > 0 && (
              <div className="px-4 py-1.5 bg-gray-900/30 text-xs text-gray-500">
                Depends on: {phase.dependencies.join(', ')}
              </div>
            )}

            <div className="divide-y divide-gray-800/50">
              {phase.files.map((file) => (
                <div key={file.path} className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-medium ${ACTION_COLORS[file.action] || 'text-gray-400'}`}>
                      {file.action}
                    </span>
                    <span className="text-sm text-gray-400 font-mono truncate">{file.path}</span>
                    {file.newPath && (
                      <>
                        <span className="text-gray-600">→</span>
                        <span className="text-sm text-gray-400 font-mono truncate">{file.newPath}</span>
                      </>
                    )}
                  </div>
                  <span className="text-xs text-gray-600 ml-2 shrink-0">
                    ~{formatTokens(file.estimatedTokens)} tokens
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Approve button */}
      {plan.status === 'AWAITING_APPROVAL' && (
        <div className="flex justify-center pt-4">
          <button
            onClick={onApprove}
            disabled={approving}
            className="px-8 py-3 bg-indigo-600 text-white rounded-lg font-medium
              hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
              flex items-center gap-2"
          >
            {approving ? (
              <>
                <span className="animate-spin-slow">⏳</span>
                Approving...
              </>
            ) : (
              <>✅ Approve & Start Building</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
