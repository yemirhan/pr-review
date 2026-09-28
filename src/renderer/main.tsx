import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import { App } from './App';
import type { ApiError } from './lib/api';
import './theme.css';

/** Only transient failures are worth an automatic retry. */
const TRANSIENT = new Set(['TIMEOUT', 'UNKNOWN']);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      // Focus/reconnect refetches fanned out to every mounted query at once
      // (PR list per repo + detail + files + comments + checks) and were the
      // main trigger for GitHub's secondary rate limits (HTTP 429). Data now
      // refreshes on demand (Refresh buttons), after mutations, and through
      // the targeted polls in PRDetail / ChecksView.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: (failureCount, error) => {
        const code = (error as ApiError | undefined)?.code;
        // Rate limited: the main process tells us how long the cooldown is;
        // keep retrying (slowly) so the UI heals itself without user action.
        if (code === 'RATE_LIMITED') return failureCount < 4;
        if (code && TRANSIENT.has(code)) return failureCount < 1;
        return false;
      },
      retryDelay: (attempt, error) => {
        const e = error as ApiError | undefined;
        if (e?.code === 'RATE_LIMITED') {
          return Math.min(e.retryAfterMs ?? 30_000, 90_000) + 500;
        }
        return Math.min(1000 * 2 ** attempt, 8000);
      }
    }
  }
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkerPoolContextProvider
        poolOptions={{
          workerFactory: () =>
            new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
              type: 'module'
            }),
          poolSize: 4
        }}
        highlighterOptions={{}}
      >
        <App />
      </WorkerPoolContextProvider>
    </QueryClientProvider>
  </StrictMode>
);
