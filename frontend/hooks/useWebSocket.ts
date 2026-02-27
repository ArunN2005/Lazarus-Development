'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { LazarusWebSocket, WebSocketEvent } from '@/lib/websocket';
import { getIdToken } from '@/lib/auth';

interface UseWebSocketOptions {
  projectId: string;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  connected: boolean;
  events: WebSocketEvent[];
  lastEvent: WebSocketEvent | null;
  clearEvents: () => void;
}

export function useWebSocket({ projectId, enabled = true }: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const wsRef = useRef<LazarusWebSocket | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLastEvent(null);
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) {
      console.warn('NEXT_PUBLIC_WS_URL not configured');
      return;
    }

    const idToken = getIdToken();
    if (!idToken) {
      console.warn('WebSocket: no id_token available, skipping connection');
      return;
    }

    // Authorizer expects ?token=<idToken>; connect handler reads ?projectId=
    const url = `${wsUrl}?token=${encodeURIComponent(idToken)}&projectId=${encodeURIComponent(projectId)}`;

    const ws = new LazarusWebSocket({
      url,
      projectId,
      onEvent: (event) => {
        setEvents((prev) => [...prev, event]);
        setLastEvent(event);
      },
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      maxRetries: 5,
    });

    ws.connect();
    wsRef.current = ws;

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [projectId, enabled]);

  return { connected, events, lastEvent, clearEvents };
}
