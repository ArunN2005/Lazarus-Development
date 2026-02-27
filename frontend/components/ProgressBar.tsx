'use client';

interface ProgressBarProps {
  progress: number;
  label?: string;
  sublabel?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

const VARIANT_COLORS = {
  default: 'bg-indigo-500',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

const SIZE_HEIGHTS = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export default function ProgressBar({
  progress,
  label,
  sublabel,
  variant = 'default',
  size = 'md',
  animated = true,
}: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <div className="w-full">
      {(label || sublabel) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-sm text-gray-300">{label}</span>}
          {sublabel && <span className="text-xs text-gray-500">{sublabel}</span>}
        </div>
      )}
      <div className={`w-full bg-gray-800 rounded-full overflow-hidden ${SIZE_HEIGHTS[size]}`}>
        <div
          className={`
            ${SIZE_HEIGHTS[size]} rounded-full transition-all duration-700 ease-out
            ${VARIANT_COLORS[variant]}
            ${animated && clamped > 0 && clamped < 100 ? 'animate-pulse' : ''}
          `}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {clamped > 0 && (
        <div className="text-right mt-0.5">
          <span className="text-xs text-gray-600">{Math.round(clamped)}%</span>
        </div>
      )}
    </div>
  );
}
