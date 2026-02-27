'use client';

const PHASES = [
  { key: 'INSPECTING', label: 'Inspect', icon: '🔍', description: 'Scanning repository' },
  { key: 'PLANNING', label: 'Plan', icon: '📋', description: 'Creating migration plan' },
  { key: 'AWAITING_APPROVAL', label: 'Approve', icon: '✅', description: 'Waiting for approval' },
  { key: 'BUILDING', label: 'Build', icon: '🔨', description: 'Generating code' },
  { key: 'TESTING', label: 'Test', icon: '🧪', description: 'Running sandbox tests' },
  { key: 'DEPLOYING', label: 'Deploy', icon: '🚀', description: 'Deploying to cloud' },
  { key: 'VALIDATING', label: 'Validate', icon: '🩺', description: 'Health checks' },
  { key: 'COMPLETED', label: 'Done', icon: '🎉', description: 'Migration complete' },
];

interface PhaseTimelineProps {
  currentPhase: string;
  progress?: number;
}

export default function PhaseTimeline({ currentPhase, progress }: PhaseTimelineProps) {
  const currentIndex = PHASES.findIndex((p) => p.key === currentPhase);
  const isFailed = currentPhase === 'FAILED';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between relative">
        {/* Line connecting dots */}
        <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-700" />
        <div
          className="absolute top-4 left-4 h-0.5 bg-indigo-500 transition-all duration-700"
          style={{
            width: isFailed
              ? `${((currentIndex) / (PHASES.length - 1)) * 100}%`
              : `${((currentIndex) / (PHASES.length - 1)) * 100}%`,
          }}
        />

        {PHASES.map((phase, i) => {
          const isActive = phase.key === currentPhase;
          const isComplete = i < currentIndex;
          const isPending = i > currentIndex;

          return (
            <div key={phase.key} className="relative flex flex-col items-center z-10">
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm
                  transition-all duration-300
                  ${isComplete ? 'bg-indigo-600 text-white' : ''}
                  ${isActive ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/30 animate-pulse-glow' : ''}
                  ${isPending ? 'bg-gray-800 text-gray-500 border border-gray-600' : ''}
                  ${isFailed && isActive ? 'bg-red-600 ring-red-500/30' : ''}
                `}
              >
                {isComplete ? '✓' : phase.icon}
              </div>
              <span
                className={`
                  mt-2 text-xs font-medium whitespace-nowrap
                  ${isActive ? 'text-indigo-400' : ''}
                  ${isComplete ? 'text-gray-400' : ''}
                  ${isPending ? 'text-gray-600' : ''}
                `}
              >
                {phase.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current phase info */}
      {currentIndex >= 0 && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-400">
            {isFailed ? 'Migration failed' : PHASES[currentIndex]?.description}
          </p>
          {progress !== undefined && progress > 0 && progress < 100 && (
            <div className="mt-2 max-w-xs mx-auto">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">{Math.round(progress)}%</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
