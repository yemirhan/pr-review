import { useQueryClient, useQueries } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import { useState } from 'react';
import type { Repo } from '@shared/types';

export function Sidebar({ repos, loading }: { repos: Repo[]; loading: boolean }) {
  const qc = useQueryClient();
  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectRepo = useUI((s) => s.selectRepo);
  const [addingErr, setAddingErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Fetch open-PR counts for each repo, in parallel.
  const counts = useQueries({
    queries: repos.map((r) => ({
      queryKey: qk.prs(r.id),
      queryFn: () => unwrap(api.prs.list(r.id)),
      staleTime: 60_000
    }))
  });

  async function onAdd() {
    setAdding(true);
    setAddingErr(null);
    try {
      const repo = await unwrap(api.repos.add());
      if (repo) {
        await qc.invalidateQueries({ queryKey: qk.repos });
        selectRepo(repo.id);
      }
    } catch (e) {
      const ae = e as ApiError;
      setAddingErr(ae.message);
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(id: string) {
    await unwrap(api.repos.remove(id));
    await qc.invalidateQueries({ queryKey: qk.repos });
    if (id === selectedRepoId) selectRepo(null);
  }

  const toggleSidebar = useUI((s) => s.toggleSidebar);

  return (
    <aside className="w-64 shrink-0 border-r border-border-muted bg-canvas-inset/40 flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-2xs uppercase tracking-wider text-fg-subtle font-semibold">
          Repositories
        </span>
        <button
          onClick={toggleSidebar}
          className="btn-icon h-6 w-6"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <ChevronLeft />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {loading && <div className="px-2 text-xs text-fg-muted">Loading…</div>}
        {repos.map((r, i) => {
          const c = counts[i];
          const count = c.data?.length ?? 0;
          const selected = r.id === selectedRepoId;
          return (
            <button
              key={r.id}
              onClick={() => selectRepo(r.id)}
              className={`group w-full text-left px-2.5 py-2 rounded-lg flex items-center justify-between transition-colors duration-100 ${
                selected
                  ? 'bg-accent-subtle text-fg border border-accent/40'
                  : 'border border-transparent hover:bg-canvas-subtle text-fg-muted hover:text-fg'
              }`}
            >
              <span className="flex flex-col min-w-0">
                <span className="truncate text-sm font-medium text-fg">{r.label}</span>
                <span className="truncate text-2xs text-fg-subtle">
                  {r.owner}/{r.name}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <span
                  className={`text-2xs px-1.5 h-5 inline-flex items-center rounded-full font-medium ${
                    count > 0
                      ? 'bg-accent-subtle text-accent border border-accent/30'
                      : 'bg-canvas-subtle text-fg-subtle border border-border-muted'
                  }`}
                >
                  {c.isLoading ? '…' : count}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(r.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-danger px-1"
                  title="Remove repo"
                >
                  ×
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t border-border-muted p-2">
        <button onClick={onAdd} disabled={adding} className="btn w-full">
          {adding ? 'Selecting…' : '+ Add repo'}
        </button>
        {addingErr && <div className="mt-2 text-2xs text-danger">{addingErr}</div>}
      </div>
    </aside>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 4l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
