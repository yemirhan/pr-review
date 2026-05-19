import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import { tileColor, tileLetter } from '../lib/colorFromId';
import type { Repo } from '@shared/types';

export function SidebarRail({ repos }: { repos: Repo[] }) {
  const qc = useQueryClient();
  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectRepo = useUI((s) => s.selectRepo);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const [adding, setAdding] = useState(false);

  const counts = useQueries({
    queries: repos.map((r) => ({
      queryKey: qk.prs(r.id),
      queryFn: () => unwrap(api.prs.list(r.id)),
      staleTime: 60_000
    }))
  });

  async function onAdd() {
    setAdding(true);
    try {
      const repo = await unwrap(api.repos.add());
      if (repo) {
        await qc.invalidateQueries({ queryKey: qk.repos });
        selectRepo(repo.id);
      }
    } catch (e) {
      console.warn('add repo failed', (e as ApiError).message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside className="w-12 shrink-0 border-r border-border-muted bg-canvas-inset/40 flex flex-col">
      <button
        onClick={toggleSidebar}
        className="btn-icon mx-auto mt-2"
        title="Expand sidebar"
        aria-label="Expand sidebar"
      >
        <ChevronRight />
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-3 px-1.5 space-y-2">
        {repos.map((r, i) => {
          const c = counts[i];
          const count = c.data?.length ?? 0;
          const selected = r.id === selectedRepoId;
          const { bg, fg } = tileColor(r.id);
          return (
            <button
              key={r.id}
              onClick={() => selectRepo(r.id)}
              className="relative block mx-auto h-9 w-9 rounded-lg overflow-visible focus:outline-none"
              title={`${r.label} · ${count} open`}
            >
              <span
                className={`flex h-full w-full items-center justify-center rounded-lg text-[13px] font-semibold transition-transform duration-100 ${
                  selected
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-canvas-inset'
                    : 'hover:scale-[1.05]'
                }`}
                style={{ background: bg, color: fg }}
              >
                {tileLetter(r.label)}
              </span>
              {count > 0 && (
                <span className="absolute -right-1 -bottom-1 h-4 min-w-[16px] px-1 rounded-full bg-accent text-[10px] font-semibold text-fg-onAccent flex items-center justify-center ring-2 ring-canvas-inset">
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button
          onClick={onAdd}
          disabled={adding}
          className="block mx-auto h-9 w-9 rounded-lg border border-dashed border-border text-fg-subtle hover:text-fg hover:border-fg-subtle transition-colors duration-100"
          title="Add repo"
          aria-label="Add repo"
        >
          {adding ? '…' : '+'}
        </button>
      </div>
    </aside>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
