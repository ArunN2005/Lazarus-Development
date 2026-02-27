'use client';

interface HealthBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function getHealthColor(score: number): { bg: string; text: string; ring: string } {
  if (score >= 90) return { bg: 'bg-green-500', text: 'text-green-400', ring: 'ring-green-500/30' };
  if (score >= 70) return { bg: 'bg-yellow-500', text: 'text-yellow-400', ring: 'ring-yellow-500/30' };
  if (score >= 50) return { bg: 'bg-orange-500', text: 'text-orange-400', ring: 'ring-orange-500/30' };
  return { bg: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500/30' };
}

function getHealthLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 50) return 'Fair';
  return 'Poor';
}

const sizes = {
  sm: { container: 'w-10 h-10', text: 'text-xs', label: 'text-[10px]' },
  md: { container: 'w-16 h-16', text: 'text-lg', label: 'text-xs' },
  lg: { container: 'w-24 h-24', text: 'text-3xl', label: 'text-sm' },
};

export default function HealthBadge({ score, size = 'md', showLabel = true }: HealthBadgeProps) {
  const colors = getHealthColor(score);
  const s = sizes[size];

  // SVG circle parameters
  const radius = size === 'sm' ? 16 : size === 'md' ? 26 : 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const svgSize = size === 'sm' ? 40 : size === 'md' ? 64 : 96;
  const strokeWidth = size === 'sm' ? 3 : 4;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`relative ${s.container}`}>
        {/* Background circle */}
        <svg
          className="absolute inset-0"
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
        >
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            fill="none"
            stroke="#1f2937"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`${colors.text} transition-all duration-1000`}
            transform={`rotate(-90 ${svgSize / 2} ${svgSize / 2})`}
          />
        </svg>
        {/* Score text */}
        <div className={`absolute inset-0 flex items-center justify-center ${s.text} font-bold ${colors.text}`}>
          {score}
        </div>
      </div>
      {showLabel && (
        <span className={`${s.label} font-medium ${colors.text}`}>{getHealthLabel(score)}</span>
      )}
    </div>
  );
}
