import { useEffect, useRef } from 'react';
import { useCrawlStore } from '../store/useCrawlStore';

export function useWebSocket(url) {
  const ws = useRef(null);
  const updateCrawl = useCrawlStore(state => state.updateCrawl);
  const addLog = useCrawlStore(state => state.addLog);

  useEffect(() => {
    const connect = () => {
      ws.current = new WebSocket(url);
      
      ws.current.onopen = () => {
        addLog({ type: 'info', message: 'WebSocket connected for real-time updates.' });
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.crawl_id) {
             updateCrawl(data);
          }
        } catch (e) {
          console.error("Failed to parse websocket message", e);
        }
      };

      ws.current.onclose = () => {
        addLog({ type: 'warning', message: 'WebSocket disconnected. Reconnecting in 3s...' });
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [url]);
}
