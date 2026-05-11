/**
 * Singleton client for the shiki web worker.
 * Highlights blocks of code off the main thread; per-request tokens are
 * cached so re-renders don't re-hit the worker.
 */

let worker: Worker | null = null;
let nextId = 1;

interface Pending {
  resolve(tokens: string[]): void;
  reject(err: Error): void;
}
const pending = new Map<number, Pending>();

const cache = new Map<string, string[]>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/shiki.worker.ts', import.meta.url), {
    type: 'module'
  });
  worker.onmessage = (e: MessageEvent) => {
    const data = e.data as
      | { id: number; ok: true; tokens: string[] }
      | { id: number; ok: false; error: string };
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.ok) p.resolve(data.tokens);
    else p.reject(new Error(data.error));
  };
  return worker;
}

function key(lang: string, code: string): string {
  // Hash by length + a few chars; collisions are fine for cache invalidation purposes
  // because we also include the code as the key (small lines).
  return `${lang}::${code.length}::${code}`;
}

export function highlightLines(lang: string, code: string): Promise<string[]> {
  const k = key(lang, code);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);

  const w = ensureWorker();
  const id = nextId++;
  return new Promise<string[]>((resolve, reject) => {
    pending.set(id, {
      resolve: (tokens) => {
        cache.set(k, tokens);
        resolve(tokens);
      },
      reject
    });
    w.postMessage({ id, lang, code });
  });
}
