'use client';

import { CostBreakdownData } from '@/lib/api';

interface CostBreakdownProps {
  data: CostBreakdownData;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

const PHASE_LABELS: Record<string, string> = {
  inspector: 'Inspector',
  architect: 'Architect',
  builder: 'Builder',
  sandbox: 'Sandbox',
  deployer: 'Deployer',
  validator: 'Validator',
};

const PHASE_COLORS: Record<string, string> = {
  inspector: 'bg-blue-500',
  architect: 'bg-purple-500',
  builder: 'bg-amber-500',
  sandbox: 'bg-green-500',
  deployer: 'bg-rose-500',
  validator: 'bg-cyan-500',
};

export default function CostBreakdown({ data }: CostBreakdownProps) {
  const maxCost = Math.max(...data.breakdown.map((b) => b.cost), 0.001);

  return (
    <div className="space-y-4">
      {/* Total */}
      <div className="glass rounded-lg p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Total Cost</span>
          <span className="text-2xl font-bold text-white">{formatCost(data.totalCost)}</span>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          <span>
            {formatTokens(data.breakdown.reduce((s, b) => s + b.inputTokens, 0))} input tokens
          </span>
          <span>
            {formatTokens(data.breakdown.reduce((s, b) => s + b.outputTokens, 0))} output tokens
          </span>
        </div>
      </div>

      {/* Per-phase breakdown */}
      <div className="space-y-2">
        {data.breakdown.map((item) => (
          <div key={item.phase} className="glass rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[item.phase] || 'bg-gray-500'}`} />
                <span className="text-sm text-gray-300">
                  {PHASE_LABELS[item.phase] || item.phase}
                </span>
                <span className="text-xs text-gray-600">{item.model}</span>
              </div>
              <span className="text-sm font-medium text-white">{formatCost(item.cost)}</span>
            </div>
            {/* Bar */}
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${PHASE_COLORS[item.phase] || 'bg-gray-500'}`}
                style={{ width: `${(item.cost / maxCost) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-gray-600">
              <span>In: {formatTokens(item.inputTokens)}</span>
              <span>Out: {formatTokens(item.outputTokens)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
