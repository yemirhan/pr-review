import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Repo } from '@shared/types';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import { cn } from '../lib/cn';
import { Skeleton } from './ui/skeleton';

/** Folder picker → add repo → refresh lists → select it. Shared by Sidebar and Empty. */
export function useAddRepo() {
  const qc = useQueryClient();
  const selectRepo = useUI((s) => s.selectRepo);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const repo = await unwrap(api.repos.add());
      if (repo) {
        await qc.invalidateQueries({ queryKey: qk.repos });
        await qc.invalidateQueries({ queryKey: qk.openCounts });
        selectRepo(repo.id);
      }
    } catch (e) {
      setError(addRepoMessage(e as ApiError));
    } finally {
      setAdding(false);
    }
  }

  return { add, adding, error, setError };
}

export function addRepoMessage(e: ApiError): string {
  switch (e.code) {
    case 'NOT_A_GIT_REPO':
      return 'That folder is not a git repository.';
    case 'NOT_A_GITHUB_REMOTE':
      return 'No GitHub origin remote on this repo.';
    case 'GH_NOT_INSTALLED':
      return 'gh CLI not found. Install with `brew install gh`.';
    case 'GH_NOT_AUTHENTICATED':
      return 'gh CLI is not authenticated. Run `gh auth login` in your terminal.';
    default:
      return e.message;
  }
}

export function Sidebar({ repos, loading }: { repos: Repo[]; loading: boolean }) {
  const qc = useQueryClient();
  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectRepo = useUI((s) => s.selectRepo);
  const { add, adding, error, setError } = useAddRepo();

  // One batched GraphQL request for every repo's open-PR count.
  const countsQ = useQuery({
    queryKey: qk.openCounts,
    queryFn: () => unwrap(api.repos.openCounts()),
    enabled: repos.length > 0,
    staleTime: 2 * 60_000
  });

  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of repos) m.set(r.name, (m.get(r.name) ?? 0) + 1);
    return m;
  }, [repos]);

  async function onRemove(id: string) {
    try {
      await unwrap(api.repos.remove(id));
      await qc.invalidateQueries({ queryKey: qk.repos });
      await qc.invalidateQueries({ queryKey: qk.openCounts });
      if (id === selectedRepoId) selectRepo(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-muted">
      <div className="px-4 pb-1.5 pt-4 text-2xs font-medium text-fg-subtle">Repositories</div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex h-8 items-center justify-between px-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-4" />
            </div>
          ))}
        {repos.map((r) => {
          const selected = r.id === selectedRepoId;
          const shared = (nameCounts.get(r.name) ?? 0) > 1;
          const count = countsQ.data?.[r.id];
          return (
            <div key={r.id} className="group relative">
              <button
                onClick={() => selectRepo(r.id)}
                title={shared ? undefined : `${r.owner}/${r.name}`}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                  shared ? 'py-1.5' : 'h-8',
                  selected
                    ? 'bg-canvas-subtle text-fg'
                    : 'text-fg-muted hover:bg-canvas-subtle/60 hover:text-fg'
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-[13px]', selected && 'font-medium')}>
                    {r.name}
                  </span>
                  {shared && <span className="truncate text-2xs text-fg-subtle">{r.owner}</span>}
                </span>
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle group-hover:invisible group-focus-within:invisible">
                  {count != null && count > 0 ? count : ''}
                </span>
              </button>
              <button
                onClick={() => onRemove(r.id)}
                className="btn-icon absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                title={`Remove ${r.owner}/${r.name}`}
                aria-label={`Remove ${r.owner}/${r.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </nav>
      <div className="px-2 pb-3 pt-1">
        <button onClick={add} disabled={adding} className="btn-ghost w-full justify-start">
          <Plus className="h-3.5 w-3.5" />
          {adding ? 'Selecting…' : 'Add repository'}
        </button>
        {error && <div className="mt-1.5 px-2 text-2xs text-danger">{error}</div>}
      </div>
    </aside>
  );
}
