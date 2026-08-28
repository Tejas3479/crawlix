import { useEffect, useRef } from 'react';
import { useCrawlStore } from '../store/useCrawlStore';

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const updateCrawl = useCrawlStore((state) => state.updateCrawl);
  const addLog = useCrawlStore((state) => state.addLog);
  const setHealth = useCrawlStore((state) => state.setHealth);

  useEffect(() => {
    let isMounted = true;

    const connect = () => {
      // Build proper ws protocol and host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws/crawls`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          addLog({
            type: 'info',
            message: 'Real-time WebSocket stream connected for live crawls.',
          });
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.crawl_id) {
              updateCrawl(data);
              addLog({
                type: 'info',
                message: `Crawl [${data.crawl_id.slice(0, 8)}] update: ${data.status} (${data.pages_crawled} pages)`,
              });
            }
          } catch (e) {
            console.error('Failed to parse WebSocket frame:', e);
          }
        };

        ws.onerror = (err) => {
          // Silent or logged
        };

        ws.onclose = () => {
          if (!isMounted) return;
          // Exponential / backoff retry
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        };
      } catch (err) {
        if (isMounted) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    // Periodic health polling (every 10s)
    const healthInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const healthData = await res.json();
          setHealth(healthData);
        }
      } catch {
        setHealth({
          status: 'offline',
          database: 'error',
          redis: 'error',
          active_sessions: 0,
          playwright_slots_free: 0,
        });
      }
    }, 10000);

    // Initial health check
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => {});

    return () => {
      isMounted = false;
      clearInterval(healthInterval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [updateCrawl, addLog, setHealth]);
}
