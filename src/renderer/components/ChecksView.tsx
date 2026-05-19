import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ExternalLink,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { relativeTime } from '../lib/format';
import type { PRCheckBucket, PRCheckRun, Repo } from '@shared/types';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { Spinner } from './ui/spinner';
import { cn } from '../lib/cn';

const POLL_BUCKETS: PRCheckBucket[] = ['pending'];

export function ChecksView({ repo, prNumber }: { repo: Repo; prNumber: number }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.prChecks(repo.id, prNumber),
    queryFn: () => unwrap(api.prs.checks(repo.id, prNumber)),
    // Light auto-refresh while anything is still running.
    refetchInterval: (query) => {
      const data = query.state.data as PRCheckRun[] | undefined;
      if (data && data.some((c) => POLL_BUCKETS.includes(c.bucket))) {
        return 15_000;
      }
      return false;
    },
    staleTime: 10_000
  });

  const grouped = useMemo(() => groupByWorkflow(q.data ?? []), [q.data]);
  const summary = useMemo(() => summarize(q.data ?? []), [q.data]);

  if (q.isLoading) {
    return <ChecksSkeleton />;
  }
  if (q.error) {
    return (
      <div className="p-6">
        <div className="text-danger bg-danger-subtle border border-danger-emphasis/40 rounded-md px-4 py-3 max-w-xl">
          {(q.error as ApiError).message}
        </div>
      </div>
    );
  }

  const checks = q.data ?? [];
  if (checks.length === 0) {
    return (
      <div className="p-6 text-fg-subtle text-sm">
        No checks have run for this PR yet.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-5 py-3 border-b border-border-muted flex items-center gap-3 sticky top-0 bg-canvas/95 backdrop-blur z-10">
        <SummaryPill label="Passed" value={summary.pass} tone="success" />
        <SummaryPill label="Failed" value={summary.fail} tone="danger" />
        <SummaryPill label="Running" value={summary.pending} tone="attention" />
        {summary.skipping > 0 && (
          <SummaryPill label="Skipped" value={summary.skipping} tone="muted" />
        )}
        <div className="ml-auto flex items-center gap-2">
          {q.isFetching && <Spinner size="xs" />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: qk.prChecks(repo.id, prNumber) })}
            disabled={q.isFetching}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {grouped.map(({ workflow, runs }) => (
          <WorkflowBlock key={workflow} workflow={workflow} runs={runs} />
        ))}
      </div>
    </div>
  );
}

function SummaryPill({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: 'success' | 'danger' | 'attention' | 'muted';
}) {
  if (value === 0 && tone !== 'success' && tone !== 'danger') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-2xs h-6 px-2 rounded-full border',
        tone === 'success' && 'border-success/30 bg-success-subtle text-success',
        tone === 'danger' && 'border-danger/30 bg-danger-subtle text-danger',
        tone === 'attention' &&
          'border-attention/30 bg-attention-subtle text-attention',
        tone === 'muted' && 'border-border-muted bg-canvas-subtle text-fg-muted'
      )}
    >
      <span className="font-mono tabular-nums font-semibold">{value}</span>
      {label}
    </span>
  );
}

function WorkflowBlock({
  workflow,
  runs
}: {
  workflow: string;
  runs: PRCheckRun[];
}) {
  const worst = worstBucket(runs);
  return (
    <section className="rounded-md border border-border-muted overflow-hidden">
      <header className="px-3 py-2 border-b border-border-muted bg-canvas-inset/50 flex items-center gap-2">
        <BucketDot bucket={worst} />
        <span className="text-sm font-medium text-fg truncate">{workflow}</span>
        <span className="text-2xs text-fg-subtle ml-1">{runs.length} {runs.length === 1 ? 'job' : 'jobs'}</span>
      </header>
      <ul className="divide-y divide-border-muted">
        {runs.map((c, i) => (
          <li key={`${c.name}-${i}`}>
            <CheckRow run={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckRow({ run }: { run: PRCheckRun }) {
  const duration = computeDuration(run.startedAt, run.completedAt);
  const Wrapper = run.link ? 'a' : 'div';
  return (
    <Wrapper
      {...(run.link
        ? {
            href: run.link,
            onClick: (e: React.MouseEvent) => {
              e.preventDefault();
              api.shell.openExternal(run.link!);
            }
          }
        : {})}
      className={cn(
        'flex items-center gap-3 px-3 py-2',
        run.link && 'hover:bg-canvas-subtle/60 cursor-pointer transition-colors'
      )}
    >
      <BucketIcon bucket={run.bucket} state={run.state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg truncate">{run.name}</span>
          <BucketBadge bucket={run.bucket} state={run.state} />
        </div>
        {run.description && (
          <div className="text-2xs text-fg-subtle truncate mt-0.5">
            {run.description}
          </div>
        )}
      </div>
      <div className="text-2xs text-fg-subtle font-mono tabular-nums shrink-0 text-right">
        {duration && <div>{duration}</div>}
        {run.completedAt ? (
          <div>{relativeTime(run.completedAt)}</div>
        ) : run.startedAt ? (
          <div>started {relativeTime(run.startedAt)}</div>
        ) : null}
      </div>
      {run.link && <ExternalLink className="h-3 w-3 text-fg-subtle shrink-0" />}
    </Wrapper>
  );
}

function BucketIcon({
  bucket,
  state
}: {
  bucket: PRCheckBucket;
  state: string | null;
}) {
  const cls = 'h-4 w-4 shrink-0';
  if (bucket === 'pass') return <CheckCircle2 className={cn(cls, 'text-success')} />;
  if (bucket === 'fail') return <XCircle className={cn(cls, 'text-danger')} />;
  if (bucket === 'skipping' || bucket === 'cancel')
    return <CircleSlash className={cn(cls, 'text-fg-subtle')} />;
  // pending — show a spinner if actively running, else dashed circle.
  const running = (state ?? '').toUpperCase() === 'IN_PROGRESS';
  if (running) return <Spinner size="md" className="text-attention" />;
  return <CircleDashed className={cn(cls, 'text-attention')} />;
}

function BucketDot({ bucket }: { bucket: PRCheckBucket }) {
  const color =
    bucket === 'pass'
      ? 'bg-success'
      : bucket === 'fail'
        ? 'bg-danger'
        : bucket === 'pending'
          ? 'bg-attention'
          : 'bg-fg-subtle';
  return <span className={cn('h-2 w-2 rounded-full shrink-0', color)} />;
}

function BucketBadge({
  bucket,
  state
}: {
  bucket: PRCheckBucket;
  state: string | null;
}) {
  const label = humanState(bucket, state);
  if (!label) return null;
  const cls =
    bucket === 'pass'
      ? 'text-success'
      : bucket === 'fail'
        ? 'text-danger'
        : bucket === 'pending'
          ? 'text-attention'
          : 'text-fg-subtle';
  return <span className={cn('text-2xs font-medium', cls)}>{label}</span>;
}

function humanState(bucket: PRCheckBucket, state: string | null): string {
  const raw = (state ?? '').toUpperCase();
  if (raw === 'IN_PROGRESS') return 'running';
  if (raw === 'QUEUED' || raw === 'WAITING' || raw === 'PENDING') return 'queued';
  if (raw === 'NEUTRAL') return 'neutral';
  if (raw === 'TIMED_OUT') return 'timed out';
  if (bucket === 'pass') return 'passed';
  if (bucket === 'fail') return 'failed';
  if (bucket === 'skipping') return 'skipped';
  if (bucket === 'cancel') return 'cancelled';
  return 'pending';
}

function computeDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const BUCKET_ORDER: Record<PRCheckBucket, number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  cancel: 3,
  skipping: 4
};

function worstBucket(runs: PRCheckRun[]): PRCheckBucket {
  let best: PRCheckBucket = 'pass';
  let bestRank = BUCKET_ORDER.pass;
  for (const r of runs) {
    const rank = BUCKET_ORDER[r.bucket];
    if (rank < bestRank) {
      best = r.bucket;
      bestRank = rank;
    }
  }
  return best;
}

function groupByWorkflow(runs: PRCheckRun[]): { workflow: string; runs: PRCheckRun[] }[] {
  const map = new Map<string, PRCheckRun[]>();
  for (const r of runs) {
    const key = r.workflow || 'Other checks';
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([workflow, list]) => ({
      workflow,
      runs: list.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket])
    }))
    .sort((a, b) => BUCKET_ORDER[worstBucket(a.runs)] - BUCKET_ORDER[worstBucket(b.runs)]);
}

function summarize(runs: PRCheckRun[]) {
  const acc = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
  for (const r of runs) acc[r.bucket]++;
  return acc;
}

function ChecksSkeleton() {
  return (
    <div className="flex-1 overflow-hidden animate-fade-in">
      <div className="px-5 py-3 border-b border-border-muted flex items-center gap-3">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-16 ml-auto" />
      </div>
      <div className="p-5 space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border-muted overflow-hidden">
            <div className="px-3 py-2 border-b border-border-muted bg-canvas-inset/50 flex items-center gap-2">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3 w-12" />
            </div>
            <div className="divide-y divide-border-muted">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-3 w-14" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
