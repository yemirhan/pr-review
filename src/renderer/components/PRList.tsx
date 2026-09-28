import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useMemo, useState, useEffect } from 'react';
import type { Repo, PRSummary, PRListState, AISessionSummary } from '@shared/types';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import { relativeTime } from '../lib/format';
import { useAISessionSummaries } from '../lib/aiSessions';
import { LOCAL_CLOSE_GRACE_MS } from '../lib/shortcuts';
import { cn } from '../lib/cn';
import { CreatePRModal } from './CreatePRModal';
import { Skeleton } from './ui/skeleton';
import { Spinner } from './ui/spinner';

type FilterMode = 'all' | 'ready' | 'draft';

const STATES: { value: PRListState; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' }
];

const FILTERS: { value: FilterMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'draft', label: 'Drafts' }
];

export function PRList({ repo }: { repo: Repo | null }) {
  const qc = useQueryClient();
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);
  const selectPR = useUI((s) => s.selectPR);
  const openPR = useUI((s) => s.openPR);
  const locallyClosed = useUI((s) => s.locallyClosed);
  const aiSummaries = useAISessionSummaries();

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

  const filtered = useMemo(() => {
    const data = prsQ.data ?? [];
    const q = debounced.trim().toLowerCase();
    const now = Date.now();
    return data.filter((pr) => {
      if (state === 'open') {
        // Hide PRs we merged/closed here until GitHub's list catches up.
        const closedAt = repo ? locallyClosed[`${repo.id}:${pr.number}`] : undefined;
        if (closedAt && now - closedAt < LOCAL_CLOSE_GRACE_MS) return false;
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
  }, [prsQ.data, debounced, filter, state, locallyClosed, repo]);

  if (!repo) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-fg-subtle">
        Pick a repository
      </div>
    );
  }

  const loading = prsQ.isLoading;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[960px] px-6 pb-10 pt-6">
          {/* Header */}
          <div className="mb-4 flex items-center gap-3">
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
              <h1 className="truncate text-lg font-semibold text-fg" title={`${repo.owner}/${repo.name}`}>
                {repo.label}
              </h1>
              {!loading && prsQ.data && (
                <span className="shrink-0 text-sm text-fg-subtle">
                  {prsQ.data.length} {state}
                </span>
              )}
            </div>
            <button className="btn" onClick={() => setCreateOpen(true)} title="New pull request">
              <Plus className="h-3.5 w-3.5" />
              New PR
            </button>
            <button
              className="btn-icon"
              onClick={() => qc.invalidateQueries({ queryKey: qk.prs(repo.id, state) })}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', prsQ.isFetching && !loading && 'animate-spin')} />
            </button>
          </div>

          {/* Filters */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="segmented" role="group" aria-label="PR state">
              {STATES.map((s) => (
                <button
                  key={s.value}
                  aria-pressed={state === s.value}
                  onClick={() => {
                    setState(s.value);
                    selectPR(null);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
              <input
                className="input w-full pl-8"
                placeholder="Filter by title, #, author, branch…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault();
                    setQuery('');
                  }
                }}
              />
            </div>
            {state === 'open' && (
              <div className="segmented" role="group" aria-label="Draft filter">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    aria-pressed={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className="!px-2"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* List */}
          <div className="border-t border-border-subtle">
            {loading && (
              <div className="animate-fade-in">
                {Array.from({ length: 7 }).map((_, i) => (
                  <PRRowSkeleton key={i} />
                ))}
              </div>
            )}
            {prsQ.error && (
              <div className="py-16 text-center text-sm text-fg-muted">
                {(prsQ.error as ApiError).message || 'Failed to load pull requests'}
              </div>
            )}
            {!loading && !prsQ.error && filtered.length === 0 && (
              <div className="py-16 text-center text-sm text-fg-subtle">
                {debounced.trim() ? 'No matching pull requests' : `No ${state} pull requests`}
              </div>
            )}
            {filtered.map((pr) => (
              <PRRow
                key={pr.number}
                pr={pr}
                ai={aiSummaries.get(`${repo.id}:${pr.number}`)}
                selected={pr.number === selectedPRNumber}
                onSelect={(background) =>
                  background ? openPR(repo.id, pr.number, { background: true }) : selectPR(pr.number)
                }
                onReview={() => {
                  // Start the agent and park the PR in a background tab.
                  void unwrap(api.ai.startReview(repo.id, pr.number)).then((sess) =>
                    qc.setQueryData(qk.aiSession(repo.id, pr.number), sess)
                  );
                  openPR(repo.id, pr.number, { background: true });
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <CreatePRModal
        repo={repo}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(num) => {
          setCreateOpen(false);
          setState('open');
          qc.invalidateQueries({ queryKey: qk.prs(repo.id, 'open') });
          qc.invalidateQueries({ queryKey: qk.openCounts });
          selectPR(num);
        }}
      />
    </div>
  );
}

function PRRow({
  pr,
  ai,
  selected,
  onSelect,
  onReview
}: {
  pr: PRSummary;
  ai: AISessionSummary | undefined;
  selected: boolean;
  /** `background`: ⌘/Ctrl/middle click opens a tab without switching to it. */
  onSelect: (background: boolean) => void;
  onReview: () => void;
}) {
  const when =
    pr.state === 'MERGED' && pr.mergedAt
      ? `merged ${relativeTime(pr.mergedAt)}`
      : pr.state === 'CLOSED' && pr.closedAt
        ? `closed ${relativeTime(pr.closedAt)}`
        : relativeTime(pr.updatedAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => onSelect(e.metaKey || e.ctrlKey)}
      onAuxClick={(e) => {
        if (e.button === 1) onSelect(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(e.metaKey || e.ctrlKey);
        }
      }}
      title={`${pr.headRefName} → ${pr.baseRefName}\n⌘-click to open in a background tab`}
      className={cn(
        'group relative flex w-full cursor-default items-start gap-4 border-b border-border-subtle px-4 py-2.5 text-left transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
        selected ? 'bg-canvas-subtle' : 'hover:bg-canvas-subtle/50'
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[13px] leading-[18px] text-fg">{pr.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-subtle">
          <span className="tabular-nums">#{pr.number}</span>
          <Dot />
          <span className="truncate">{pr.author.login}</span>
          <Dot />
          <span className="shrink-0">{when}</span>
          <Dot />
          <span className="shrink-0 tabular-nums">
            <span className="text-success/70">+{pr.additions}</span>{' '}
            <span className="text-danger/70">−{pr.deletions}</span>
          </span>
          {pr.reviewDecision === 'APPROVED' && (
            <>
              <Dot />
              <span className="shrink-0">approved</span>
            </>
          )}
          {pr.reviewDecision === 'CHANGES_REQUESTED' && (
            <>
              <Dot />
              <span className="shrink-0">changes requested</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pt-px">
        {pr.isDraft && <span className="chip">Draft</span>}
        {pr.state === 'OPEN' && <CIIndicator checks={pr.checks} />}
        {pr.state === 'OPEN' && ai?.status !== 'running' && (
          <button
            className="btn-ghost h-6 px-1.5 text-2xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            title="Start an AI review in a background tab"
          >
            <Sparkles className="h-3 w-3" />
            {ai ? 'Re-review' : 'Review'}
          </button>
        )}
        <AIBadge ai={ai} />
      </div>
    </div>
  );
}

function Dot() {
  return <span className="shrink-0 text-fg-subtle/60">·</span>;
}

/** Only failing or pending CI is worth a glance; passing is the default. */
function CIIndicator({ checks }: { checks: PRSummary['checks'] }) {
  if (checks.total === 0) return null;
  const title = `${checks.passed} passed, ${checks.failed} failed, ${checks.pending} pending`;
  if (checks.state === 'FAILURE' || checks.failed > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger" title={title}>
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        <span className="tabular-nums">{checks.failed || ''}</span>
      </span>
    );
  }
  if (checks.state === 'PENDING') {
    return (
      <span className="inline-flex items-center" title={title}>
        <span className="h-1.5 w-1.5 rounded-full bg-attention" />
      </span>
    );
  }
  return null;
}

function AIBadge({ ai }: { ai: AISessionSummary | undefined }) {
  if (!ai) return null;
  if (ai.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-fg-subtle" title="AI review running">
        <Spinner size="xs" />
      </span>
    );
  }
  if (ai.status !== 'done') return null;
  if (ai.findings > 0) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs tabular-nums text-accent"
        title={`AI review: ${ai.findings} finding${ai.findings === 1 ? '' : 's'}`}
      >
        ✦ {ai.findings}
      </span>
    );
  }
  return (
    <span className="text-xs text-fg-subtle" title="AI review: no findings">
      ✦
    </span>
  );
}

function PRRowSkeleton() {
  return (
    <div className="flex items-start gap-4 border-b border-border-subtle px-4 py-2.5">
      <div className="min-w-0 flex-1 space-y-2 py-0.5">
        <Skeleton className="h-3.5 w-[70%]" />
        <Skeleton className="h-3 w-[40%]" />
      </div>
    </div>
  );
}
