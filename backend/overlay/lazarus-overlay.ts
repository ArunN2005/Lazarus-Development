// ============================================================================
// LAZARUS — Overlay Script
// Injected into deployed applications for runtime monitoring & hot-fix support
// ============================================================================

(function lazarusOverlay() {
  'use strict';

  const LAZARUS_API = (window as any).__LAZARUS_API_URL__ || '';
  const LAZARUS_WS = (window as any).__LAZARUS_WS_URL__ || '';
  const PROJECT_ID = (window as any).__LAZARUS_PROJECT_ID__ || '';

  if (!LAZARUS_API || !PROJECT_ID) return;

  // ---------------------------------------------------------------------------
  // Error tracking
  // ---------------------------------------------------------------------------

  const errorBuffer: Array<{
    message: string;
    source?: string;
    line?: number;
    col?: number;
    stack?: string;
    timestamp: string;
  }> = [];

  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Global error handler
  window.addEventListener('error', (event) => {
    errorBuffer.push({
      message: event.message,
      source: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error?.stack,
      timestamp: new Date().toISOString(),
    });
    scheduleFlush();
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    errorBuffer.push({
      message: String(event.reason),
      stack: event.reason?.stack,
      timestamp: new Date().toISOString(),
    });
    scheduleFlush();
  });

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flushErrors, 5000);
  }

  async function flushErrors() {
    flushTimer = null;
    if (errorBuffer.length === 0) return;

    const errors = errorBuffer.splice(0, errorBuffer.length);

    try {
      await fetch(`${LAZARUS_API}/projects/${PROJECT_ID}/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errors }),
      });
    } catch {
      // Silently fail — don't affect the user's app
    }
  }

  // ---------------------------------------------------------------------------
  // Performance monitoring
  // ---------------------------------------------------------------------------

  if ('PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const metrics: Record<string, number> = {};

      for (const entry of entries) {
        if (entry.entryType === 'navigation') {
          const nav = entry as PerformanceNavigationTiming;
          metrics.dns = nav.domainLookupEnd - nav.domainLookupStart;
          metrics.tcp = nav.connectEnd - nav.connectStart;
          metrics.ttfb = nav.responseStart - nav.requestStart;
          metrics.domLoad = nav.domContentLoadedEventEnd - nav.startTime;
          metrics.fullLoad = nav.loadEventEnd - nav.startTime;
        }

        if (entry.entryType === 'paint') {
          if (entry.name === 'first-contentful-paint') {
            metrics.fcp = entry.startTime;
          }
        }

        if (entry.entryType === 'largest-contentful-paint') {
          metrics.lcp = entry.startTime;
        }
      }

      if (Object.keys(metrics).length > 0) {
        fetch(`${LAZARUS_API}/projects/${PROJECT_ID}/metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metrics, timestamp: new Date().toISOString() }),
        }).catch(() => {});
      }
    });

    try {
      observer.observe({ entryTypes: ['navigation', 'paint', 'largest-contentful-paint'] });
    } catch {
      // Some entry types may not be supported
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket connection for live updates
  // ---------------------------------------------------------------------------

  if (LAZARUS_WS) {
    let ws: WebSocket | null = null;
    let reconnectAttempts = 0;

    function connectWS() {
      try {
        ws = new WebSocket(LAZARUS_WS);

        ws.onopen = () => {
          reconnectAttempts = 0;
          ws?.send(JSON.stringify({
            action: 'subscribe',
            projectId: PROJECT_ID,
          }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'hot_reload') {
              // Hot reload signal from Lazarus
              window.location.reload();
            }
          } catch {
            // Invalid message
          }
        };

        ws.onclose = () => {
          if (reconnectAttempts < 5) {
            reconnectAttempts++;
            setTimeout(connectWS, Math.min(1000 * Math.pow(2, reconnectAttempts), 30000));
          }
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available
      }
    }

    // Only connect in development/staging
    if (window.location.hostname !== 'localhost') {
      connectWS();
    }
  }

  // ---------------------------------------------------------------------------
  // Console log capturing
  // ---------------------------------------------------------------------------

  const originalConsoleError = console.error;
  console.error = function (...args: unknown[]) {
    errorBuffer.push({
      message: args.map(String).join(' '),
      timestamp: new Date().toISOString(),
    });
    scheduleFlush();
    originalConsoleError.apply(console, args);
  };

  // ---------------------------------------------------------------------------
  // Lazarus badge (optional, removable)
  // ---------------------------------------------------------------------------

  function addBadge() {
    if (document.getElementById('lazarus-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'lazarus-badge';
    badge.innerHTML = '⚡ Lazarus';
    badge.style.cssText = `
      position: fixed;
      bottom: 8px;
      right: 8px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-family: -apple-system, sans-serif;
      cursor: pointer;
      z-index: 99999;
      opacity: 0.7;
      transition: opacity 0.2s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;

    badge.addEventListener('mouseenter', () => { badge.style.opacity = '1'; });
    badge.addEventListener('mouseleave', () => { badge.style.opacity = '0.7'; });
    badge.addEventListener('click', () => {
      badge.remove();
    });

    if (document.body) {
      document.body.appendChild(badge);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        document.body.appendChild(badge);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBadge);
  } else {
    addBadge();
  }
})();
