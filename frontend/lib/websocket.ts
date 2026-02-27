'use client';

export type WebSocketEvent =
  | { type: 'PHASE_STARTED'; projectId: string; phase: string; phaseName: string; message: string; timestamp?: string }
  | { type: 'PHASE_COMPLETE'; projectId: string; phase: string; phaseName: string; message: string; timestamp?: string }
  | { type: 'PHASE_FAILED'; projectId: string; phase: string; error: string; timestamp?: string }
  | { type: 'PHASE_CHANGE'; projectId: string; phase: string; previousPhase: string; timestamp?: string }
  | { type: 'SCAN_PROGRESS'; projectId: string; totalFiles?: number; analyzedFiles?: number; message: string; timestamp?: string }
  | { type: 'TECH_STACK_DETECTED'; projectId: string; techStack: { framework: string; language: string; [k: string]: unknown }; confidence: number; timestamp?: string }
  | { type: 'PROGRESS'; projectId: string; phase: string; progress: number; message: string; timestamp?: string }
  | { type: 'FILE_GENERATED'; projectId: string; filePath: string; status: string; timestamp?: string }
  | { type: 'PLAN_READY'; projectId: string; timestamp?: string }
  | { type: 'BUILD_LOG'; projectId: string; log: string; level: string; timestamp?: string }
  | { type: 'HEALTH_UPDATE'; projectId: string; score: number; details: string; timestamp?: string }
  | { type: 'DEPLOY_STATUS'; projectId: string; status: string; url?: string; timestamp?: string }
  | { type: 'ERROR'; projectId: string; error: string; phase: string; timestamp?: string }
  | { type: 'COST_UPDATE'; projectId: string; totalCost: number; phase: string; timestamp?: string }
  | { type: 'COMPLETED'; projectId: string; deployedUrl: string; healthScore: number; timestamp?: string };

type EventHandler = (event: WebSocketEvent) => void;

interface WSOptions {
  url: string;
  projectId: string;
  onEvent: EventHandler;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  maxRetries?: number;
}

export class LazarusWebSocket {
  private ws: WebSocket | null = null;
  private options: Required<WSOptions>;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isDestroyed = false;

  constructor(options: WSOptions) {
    this.options = {
      reconnect: true,
      maxRetries: 10,
      onConnect: () => {},
      onDisconnect: () => {},
      onError: () => {},
      ...options,
    };
  }

  connect(): void {
    if (this.isDestroyed) return;

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.onopen = () => {
        this.retryCount = 0;
        this.options.onConnect();

        // Subscribe to project events
        this.send({
          action: 'subscribe',
          projectId: this.options.projectId,
        });

        // Start heartbeat
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') return;
          this.options.onEvent(data as WebSocketEvent);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.stopHeartbeat();
        this.options.onDisconnect();

        if (this.options.reconnect && !this.isDestroyed && this.retryCount < this.options.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
          this.retryTimer = setTimeout(() => {
            this.retryCount++;
            this.connect();
          }, delay);
        }
      };

      this.ws.onerror = (error) => {
        this.options.onError(error);
      };
    } catch {
      // Connection failed, will retry via onclose
    }
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ action: 'ping' });
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  unsubscribe(): void {
    this.send({
      action: 'unsubscribe',
      projectId: this.options.projectId,
    });
  }

  disconnect(): void {
    this.isDestroyed = true;
    this.stopHeartbeat();

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.ws) {
      this.unsubscribe();
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
