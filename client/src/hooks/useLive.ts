import { useEffect, useRef, useState, useCallback } from "react";

export interface LiveEvent {
  type: string;
  student?: string;
  subject?: string;
  at: string;
}

// Subscribes to /api/stream (SSE). When paused, events are dropped and the
// EventSource is closed — mirroring the demo's Pause/Resume live mode.
export function useLiveStream(paused: boolean, onEvent?: (ev: LiveEvent) => void) {
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (paused) {
      setConnected(false);
      return;
    }
    const base = import.meta.env.VITE_API_URL || "";
    const es = new EventSource(`${base}/api/stream`);
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("academic_event", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        const ev: LiveEvent = { ...data, at: new Date().toISOString() };
        setLastEvent(ev);
        setEventCount(c => c + 1);
        handler.current?.(ev);
      } catch { /* ignore */ }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [paused]);

  const resetCount = useCallback(() => setEventCount(0), []);
  return { lastEvent, eventCount, connected, resetCount };
}
