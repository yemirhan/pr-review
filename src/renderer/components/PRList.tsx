import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import type { Repo, PRSummary, PRListState } from '@shared/types';
import { relativeTime } from '../lib/format';
import { ChecksPill } from './ChecksPill';
import { CreatePRModal } from './CreatePRModal';
import { Button } from './ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import { Skeleton } from './ui/skeleton';

type FilterMode = 'all' | 'ready' | 'draft';

export function PRList({ repo }: { repo: Repo | null }) {
  const qc = useQueryClient();
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);
  const selectPR = useUI((s) => s.selectPR);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [state, setState] = useState<PRListState>('open');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const prsQ = useQuery({
    queryKey: repo ? qk.prs(repo.id, state) : ['no-repo'],
    queryFn: () =>
      repo ? unwrap(api.prs.list(repo.id, state)) : Promise.resolve([] as PRSummary[]),
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
      if (state === 'open') {
        if (filter === 'draft' && !pr.isDraft) return false;
        if (filter === 'ready' && pr.isDraft) return false;
      }
      if (!q) return true;
      return (
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        pr.author.login.toLowerCase().includes(q) ||
        pr.headRefName.toLowerCase().includes(q) ||
        pr.baseRefName.toLowerCase().includes(q)
      );
    });
  }, [prsQ.data, debounced, filter, state]);

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
              · {prsQ.data?.length ?? 0} {state}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
              title="New pull request"
            >
              <Plus className="h-3.5 w-3.5" />
              New PR
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => qc.invalidateQueries({ queryKey: qk.prs(repo.id, state) })}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex gap-1 mb-2">
          {(['open', 'merged', 'closed'] as PRListState[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setState(s);
                selectPR(null);
              }}
              className={`text-2xs px-2.5 h-6 rounded-md border transition-colors capitalize ${
                state === s
                  ? 'bg-accent-subtle text-accent border-accent/40'
                  : 'bg-canvas-subtle border-border-muted text-fg-muted hover:text-fg'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          className="input w-full"
          placeholder="Search title, #, author, branch…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {state === 'open' && (
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
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {prsQ.isLoading && (
          <div className="animate-fade-in">
            {Array.from({ length: 6 }).map((_, i) => (
              <PRRowSkeleton key={i} />
            ))}
          </div>
        )}
        {prsQ.error && (
          <div className="p-4 text-sm text-danger">
            {((prsQ.error as ApiError).message) || 'Failed to load PRs'}
          </div>
        )}
        {!prsQ.isLoading && filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-fg-subtle">No {state} PRs</div>
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
      <CreatePRModal
        repo={repo}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(num) => {
          setCreateOpen(false);
          setState('open');
          qc.invalidateQueries({ queryKey: qk.prs(repo.id, 'open') });
          selectPR(num);
        }}
      />
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
            {pr.state === 'MERGED' && (
              <span className="chip border-accent/40 text-accent">Merged</span>
            )}
            {pr.state === 'CLOSED' && (
              <span className="chip border-danger/40 text-danger">Closed</span>
            )}
            <span className="text-2xs text-fg-subtle">#{pr.number}</span>
            <span className="text-2xs text-fg-subtle">·</span>
            <span className="text-2xs text-fg-muted truncate">@{pr.author.login}</span>
          </div>
          <div className="text-sm text-fg leading-snug line-clamp-2 mb-1">{pr.title}</div>
          <div className="text-2xs text-fg-subtle font-mono truncate mb-1" title={`${pr.headRefName} → ${pr.baseRefName}`}>
            {pr.headRefName}
          </div>
          <div className="flex items-center gap-2 text-2xs text-fg-subtle">
            <span>
              {pr.state === 'MERGED' && pr.mergedAt
                ? `merged ${relativeTime(pr.mergedAt)}`
                : pr.state === 'CLOSED' && pr.closedAt
                  ? `closed ${relativeTime(pr.closedAt)}`
                  : relativeTime(pr.updatedAt)}
            </span>
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
          {pr.state === 'OPEN' && <ChecksPill checks={pr.checks} compact />}
          <ReviewDecisionPill decision={pr.reviewDecision} />
        </div>
      </div>
    </button>
  );
}

function PRRowSkeleton() {
  return (
    <div className="block w-full px-3 py-2.5 border-b border-border-muted">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3.5 w-[85%]" />
          <Skeleton className="h-3 w-[55%]" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

function ReviewDecisionPill({ decision }: { decision: PRSummary['reviewDecision'] }) {
  if (decision === 'APPROVED')
    return <span className="chip border-success/40 text-success">✓ Approved</span>;
  if (decision === 'CHANGES_REQUESTED')
    return <span className="chip border-danger/40 text-danger">Changes</span>;
  return null;
}
