import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import type { Repo, PRSummary } from '@shared/types';
import { relativeTime } from '../lib/format';
import { ChecksPill } from './ChecksPill';
import { useMemo, useState, useEffect } from 'react';

type FilterMode = 'all' | 'ready' | 'draft';

export function PRList({ repo }: { repo: Repo | null }) {
  const qc = useQueryClient();
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);
  const selectPR = useUI((s) => s.selectPR);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const prsQ = useQuery({
    queryKey: repo ? qk.prs(repo.id) : ['no-repo'],
    queryFn: () => (repo ? unwrap(api.prs.list(repo.id)) : Promise.resolve([] as PRSummary[])),
    enabled: !!repo
  });

  // Auto-select first PR when repo or list changes.
  useEffect(() => {
    if (!repo) return;
    if (selectedPRNumber == null && prsQ.data && prsQ.data.length > 0) {
      selectPR(prsQ.data[0].number);
    }
  }, [repo, prsQ.data, selectedPRNumber, selectPR]);

  const filtered = useMemo(() => {
    const data = prsQ.data ?? [];
    const q = debounced.trim().toLowerCase();
    return data.filter((pr) => {
      if (filter === 'draft' && !pr.isDraft) return false;
      if (filter === 'ready' && pr.isDraft) return false;
      if (!q) return true;
      return (
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        pr.author.login.toLowerCase().includes(q)
      );
    });
  }, [prsQ.data, debounced, filter]);

  if (!repo) {
    return (
      <div className="w-96 shrink-0 border-r border-border-muted flex items-center justify-center text-fg-subtle">
        Select a repo
      </div>
    );
  }

  return (
    <div className="w-96 shrink-0 border-r border-border-muted flex flex-col bg-canvas">
      <div className="px-3 pt-3 pb-2 border-b border-border-muted bg-canvas-inset/40">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">
            {repo.label}{' '}
            <span className="text-fg-subtle font-normal">
              · {prsQ.data?.length ?? 0} open
            </span>
          </div>
          <button
            className="btn-ghost"
            onClick={() => qc.invalidateQueries({ queryKey: qk.prs(repo.id) })}
            title="Refresh"
          >
            ↻
          </button>
        </div>
        <input
          className="input w-full"
          placeholder="Search PRs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-1 mt-2">
          {(['all', 'ready', 'draft'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-2xs px-2 h-5 rounded-full border transition-colors ${
                filter === f
                  ? 'bg-accent-subtle text-accent border-accent/40'
                  : 'bg-canvas-subtle border-border-muted text-fg-muted hover:text-fg'
              }`}
            >
              {f === 'all' ? 'All' : f === 'ready' ? 'Ready' : 'Drafts'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {prsQ.isLoading && (
          <div className="p-4 text-sm text-fg-muted">Loading PRs…</div>
        )}
        {prsQ.error && (
          <div className="p-4 text-sm text-danger">
            {((prsQ.error as ApiError).message) || 'Failed to load PRs'}
          </div>
        )}
        {!prsQ.isLoading && filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-fg-subtle">No open PRs</div>
        )}
        {filtered.map((pr) => (
          <PRRow
            key={pr.number}
            pr={pr}
            selected={pr.number === selectedPRNumber}
            onSelect={() => selectPR(pr.number)}
          />
        ))}
      </div>
    </div>
  );
}

function PRRow({
  pr,
  selected,
  onSelect
}: {
  pr: PRSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`block w-full text-left px-3 py-2.5 border-b border-border-muted transition-colors ${
        selected ? 'bg-accent-subtle/60 border-l-2 border-l-accent' : 'hover:bg-canvas-subtle'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            {pr.isDraft && <span className="chip">Draft</span>}
            <span className="text-2xs text-fg-subtle">#{pr.number}</span>
            <span className="text-2xs text-fg-subtle">·</span>
            <span className="text-2xs text-fg-muted truncate">@{pr.author.login}</span>
          </div>
          <div className="text-sm text-fg leading-snug line-clamp-2 mb-1">{pr.title}</div>
          <div className="flex items-center gap-2 text-2xs text-fg-subtle">
            <span>{relativeTime(pr.updatedAt)}</span>
            <span>·</span>
            <span className="text-success">+{pr.additions}</span>
            <span className="text-danger">−{pr.deletions}</span>
            <span>·</span>
            <span>
              {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ChecksPill checks={pr.checks} compact />
          <ReviewDecisionPill decision={pr.reviewDecision} />
        </div>
      </div>
    </button>
  );
}

function ReviewDecisionPill({ decision }: { decision: PRSummary['reviewDecision'] }) {
  if (decision === 'APPROVED')
    return <span className="chip border-success/40 text-success">✓ Approved</span>;
  if (decision === 'CHANGES_REQUESTED')
    return <span className="chip border-danger/40 text-danger">Changes</span>;
  return null;
}
