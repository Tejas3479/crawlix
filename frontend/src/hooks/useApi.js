import { useCallback } from 'react';
import { useCrawlStore } from '../store/useCrawlStore';

export function useApi() {
  const apiKey = useCrawlStore((state) => state.apiKey);
  const addToast = useCrawlStore((state) => state.addToast);
  const addLog = useCrawlStore((state) => state.addLog);

  const request = useCallback(
    async (endpoint, options = {}) => {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      };

      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      // Handle FormData uploads (don't set content-type header)
      if (options.body instanceof FormData) {
        delete headers['Content-Type'];
      }

      try {
        const url = endpoint.startsWith('http') ? endpoint : endpoint;
        const res = await fetch(url, {
          ...options,
          headers,
        });

        if (!res.ok) {
          let errorDetail = res.statusText;
          try {
            const errData = await res.json();
            errorDetail = errData.detail || errData.error_message || errData.error || errorDetail;
          } catch {
            // Keep statusText
          }

          if (res.status === 401) {
            addToast({
              type: 'error',
              title: 'Unauthorized (401)',
              message: 'Invalid or missing API Key. Please update in Settings.',
            });
          } else if (res.status === 429) {
            addToast({
              type: 'warning',
              title: 'Rate Limit Exceeded (429)',
              message: errorDetail || 'Too many requests. Please slow down.',
            });
          }

          throw new Error(`[${res.status}] ${errorDetail}`);
        }

        // Return json or blob depending on headers/options
        if (options.responseType === 'blob') {
          return await res.blob();
        }

        return await res.json();
      } catch (err) {
        addLog({
          type: 'error',
          message: `API Call failed [${endpoint}]: ${err.message}`,
        });
        throw err;
      }
    },
    [apiKey, addToast, addLog]
  );

  return { request };
}
