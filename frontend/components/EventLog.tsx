'use client';

import { useEffect, useRef } from 'react';
import { WebSocketEvent } from '@/lib/websocket';

interface EventLogProps {
  events: WebSocketEvent[];
  maxHeight?: string;
  reverse?: boolean;
}

function getEventStyle(type: string): { icon: string; color: string; bg: string } {
  const styles: Record<string, { icon: string; color: string; bg: string }> = {
    PHASE_STARTED:       { icon: '▶', color: 'text-indigo-300', bg: 'bg-indigo-500/10' },
    PHASE_COMPLETE:      { icon: '✓', color: 'text-green-400',  bg: 'bg-green-500/5'  },
    PHASE_FAILED:        { icon: '✗', color: 'text-red-400',    bg: 'bg-red-500/10'   },
    PHASE_CHANGE:        { icon: '→', color: 'text-indigo-400', bg: ''                },
    SCAN_PROGRESS:       { icon: '⠿', color: 'text-blue-300',   bg: ''                },
    TECH_STACK_DETECTED: { icon: '🔍', color: 'text-purple-300', bg: 'bg-purple-500/5' },
    PROGRESS:            { icon: '░', color: 'text-blue-400',   bg: ''                },
    FILE_GENERATED:      { icon: '›', color: 'text-green-400',  bg: ''                },
    PLAN_READY:          { icon: '★', color: 'text-purple-400', bg: 'bg-purple-500/5' },
    BUILD_LOG:           { icon: '›', color: 'text-gray-400',   bg: ''                },
    HEALTH_UPDATE:       { icon: '♥', color: 'text-cyan-400',   bg: ''                },
    DEPLOY_STATUS:       { icon: '↑', color: 'text-amber-400',  bg: ''                },
    ERROR:               { icon: '✗', color: 'text-red-400',    bg: 'bg-red-500/10'   },
    COST_UPDATE:         { icon: '$', color: 'text-yellow-500', bg: ''                },
    COMPLETED:           { icon: '★', color: 'text-green-400',  bg: 'bg-green-500/10' },
  };
  return styles[type] ?? { icon: '·', color: 'text-gray-500', bg: '' };
}

function formatEvent(event: WebSocketEvent & Record<string, unknown>): string {
  switch (event.type) {
    case 'PHASE_STARTED':
      return `[${event.phaseName}] ${event.message}`;
    case 'PHASE_COMPLETE':
      return `[${event.phaseName}] ✓ ${event.message}`;
    case 'PHASE_FAILED':
      return `[Phase ${event.phase}] FAILED — ${event.error}`;
    case 'PHASE_CHANGE':
      return `Phase: ${event.previousPhase} → ${event.phase}`;
    case 'SCAN_PROGRESS':
      return event.analyzedFiles !== undefined
        ? `Analyzed ${event.analyzedFiles}/${event.totalFiles ?? '?'} files — ${event.message}`
        : String(event.message);
    case 'TECH_STACK_DETECTED':
      return `Detected ${(event.techStack as { framework: string; language: string }).framework} / ${(event.techStack as { framework: string; language: string }).language} (${Math.round(Number(event.confidence) * 100)}% confidence)`;
    case 'PROGRESS':
      return `[${event.phase}] ${event.message} (${event.progress}%)`;
    case 'FILE_GENERATED':
      return `Generated: ${event.filePath}`;
    case 'PLAN_READY':
      return 'Migration plan ready — review and approve to continue';
    case 'BUILD_LOG':
      return String(event.log);
    case 'HEALTH_UPDATE':
      return `Health: ${event.score}/100 — ${event.details}`;
    case 'DEPLOY_STATUS':
      return `Deploy: ${event.status}${event.url ? ` → ${event.url}` : ''}`;
    case 'ERROR':
      return `Error in [${event.phase}]: ${event.error}`;
    case 'COST_UPDATE':
      return `Cost: $${Number(event.totalCost).toFixed(4)} (${event.phase})`;
    case 'COMPLETED':
      return `✓ Complete — Health: ${event.healthScore}/100 — ${event.deployedUrl}`;
    default:
      return JSON.stringify(event);
  }
}

function formatTime(ts?: string): string {
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function EventLog({ events, maxHeight = '400px', reverse = false }: EventLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reverse && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, reverse]);

  if (events.length === 0) {
    return (
      <div className="glass rounded-lg p-6 text-center">
        <p className="text-sm text-gray-500">Waiting for pipeline events…</p>
        <p className="text-xs text-gray-600 mt-1">Events appear here in real time once the pipeline starts.</p>
      </div>
    );
  }

  const displayEvents = reverse ? [...events].reverse() : events;

  return (
    <div className="glass rounded-lg overflow-hidden flex flex-col" style={{ maxHeight }}>
      <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs font-medium text-gray-400 font-mono">Live Log</span>
        </div>
        <span className="text-xs text-gray-600">{events.length} event{events.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="overflow-y-auto flex-1 font-mono text-xs">
        {displayEvents.map((event, i) => {
          const raw = event as WebSocketEvent & Record<string, unknown>;
          const style = getEventStyle(event.type);
          const msg = formatEvent(raw);
          const ts = formatTime(raw.timestamp as string | undefined);
          return (
            <div
              key={i}
              className={`flex items-start gap-2 px-3 py-1 border-b border-gray-900/50 hover:bg-white/[0.02] ${style.bg}`}
            >
              <span className="text-gray-600 shrink-0 w-18 tabular-nums">{ts}</span>
              <span className={`shrink-0 w-3 text-center ${style.color}`}>{style.icon}</span>
              <span className={`${style.color} break-all leading-relaxed`}>{msg}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
