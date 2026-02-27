// ============================================================================
// LAZARUS — Structured Logger
// JSON structured logging for all Lambda and ECS functions
// ============================================================================

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  projectId?: string;
  phase?: number;
  duration?: number;
  [key: string]: unknown;
}

export function log(
  level: LogLevel,
  message: string,
  context?: LogContext
): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: 'lazarus',
    ...context,
  };

  // Filter out undefined values
  const clean = Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined)
  );

  if (level === 'error') {
    console.error(JSON.stringify(clean));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(clean));
  } else {
    console.log(JSON.stringify(clean));
  }
}
