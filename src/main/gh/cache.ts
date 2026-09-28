/**
 * Small in-memory cache + in-flight de-duplication for read-only gh calls.
 * GitHub's secondary rate limits punish bursts of identical requests
 * (several renderer queries hitting the same PR at once, chat turns
 * re-fetching the PR each message, etc.), so we coalesce them here.
 *
 * Entries remember *when* they were stored; each caller says how old a
 * value it is willing to accept. That lets the mergeability poll demand
 * near-fresh data while AI chat turns happily reuse a two-minute-old PR.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
}

const MAX_ENTRY_AGE_MS = 10 * 60_000;

const values = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function gc(now: number): void {
  for (const [k, e] of values) {
    if (now - e.storedAt > MAX_ENTRY_AGE_MS) values.delete(k);
  }
}

export async function cached<T>(key: string, maxAgeMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = values.get(key);
  if (hit && now - hit.storedAt <= maxAgeMs) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await fn();
      const at = Date.now();
      values.set(key, { value, storedAt: at });
      gc(at);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Drop every cached value whose key starts with `prefix`. */
export function invalidate(prefix: string): void {
  for (const k of values.keys()) {
    if (k.startsWith(prefix)) values.delete(k);
  }
}

export function invalidateAll(): void {
  values.clear();
}

export const cacheKeys = {
  repo: (owner: string, name: string) => `repo:${owner}/${name}:`,
  pr: (owner: string, name: string, num: number) => `repo:${owner}/${name}:pr:${num}:`,
  list: (owner: string, name: string) => `repo:${owner}/${name}:list:`
};
