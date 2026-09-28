import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Clock,
  ExternalLink,
  Globe,
  RefreshCw,
  RotateCw,
  Square,
  XCircle
} from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  formatDuration,
  isVercelActive,
  useBuildIntegrations,
  useJenkinsPRBuilds,
  useVercelPRDeployments
} from '../../lib/builds';
import { useUI } from '../../store/ui';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import type {
  JenkinsBuild,
  JenkinsBuildResult,
  JenkinsPipelineBuilds,
  Repo,
  VercelDeployment,
  VercelDeploymentState,
  VercelProjectDeployments
} from '@shared/types';

/**
 * One place for a PR's CI: Jenkins builds of its branch and Vercel preview
 * deployments, newest first, with the failing ones opened up.
 */
export function BuildsTab({
  repo,
  branch,
  prNumber,
  headSha
}: {
  repo: Repo;
  branch: string;
  prNumber: number;
  headSha: string;
}) {
  const qc = useQueryClient();
  const integ = useBuildIntegrations(repo.id);
  const jq = useJenkinsPRBuilds(repo.id, branch, prNumber, integ.jenkins);
  const vq = useVercelPRDeployments(repo.id, branch, headSha, integ.vercel);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      if (integ.jenkins) {
        // Bypass the branch-index cache so a just-pushed branch shows up.
        const fresh = await unwrap(api.integrations.jenkins.prBuilds(repo.id, branch, prNumber, true));
        qc.setQueryData(qk.jenkinsPRBuilds(repo.id, branch, prNumber), fresh);
      }
      await qc.invalidateQueries({ queryKey: qk.vercelPRDeployments(repo.id, branch, headSha) });
    } catch {
      await qc.invalidateQueries({ queryKey: qk.jenkinsPRBuilds(repo.id, branch, prNumber) });
    } finally {
      setRefreshing(false);
    }
  }

  const fetching = refreshing || jq.isFetching || vq.isFetching;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border-muted bg-canvas/95 px-5 text-xs text-fg-muted backdrop-blur">
        <span className="font-mono text-2xs text-fg-subtle truncate">{branch}</span>
        <span className="text-fg-subtle/60">@</span>
        <code className="font-mono text-2xs text-fg-subtle">{headSha.slice(0, 7)}</code>
        <button
          className="btn-ghost ml-auto h-7"
          onClick={() => void refresh()}
          disabled={fetching}
          title="Refresh builds"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', fetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      <div className="max-w-5xl space-y-7 px-5 py-5">
        {integ.jenkins && <JenkinsSection repo={repo} branch={branch} headSha={headSha} q={jq} />}
        {integ.vercel && <VercelSection repo={repo} headSha={headSha} q={vq} />}
        {(!integ.jenkins || !integ.vercel) && (
          <p className="text-2xs text-fg-subtle">
            {!integ.jenkinsConnected ? (
              <>
                Jenkins isn't connected. <SetupLink tab="jenkins">Connect</SetupLink>
              </>
            ) : (
              !integ.jenkins && (
                <>
                  No Jenkins pipelines are linked to {repo.label}. <SetupLink tab="jenkins">Link pipelines</SetupLink>
                </>
              )
            )}
            {!integ.vercel && (
              <>
                {!integ.jenkins && ' · '}
                Vercel isn't connected. <SetupLink tab="vercel">Connect</SetupLink>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, meta, action }: { title: string; meta?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {meta && <span className="text-2xs text-fg-subtle">{meta}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
  );
}

function SetupLink({ tab, children }: { tab: 'jenkins' | 'vercel'; children: React.ReactNode }) {
  const openSettings = useUI((s) => s.openSettings);
  return (
    <button className="text-2xs text-accent hover:underline" onClick={() => openSettings(tab)}>
      {children}
    </button>
  );
}

function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'danger'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        tone === 'muted' && 'border-border-muted text-fg-muted',
        tone === 'warn' && 'border-attention/30 bg-attention/[0.06] text-fg-muted',
        tone === 'danger' && 'border-danger/30 bg-danger/[0.06] text-danger'
      )}
    >
      {tone !== 'muted' && <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// --- Jenkins ------------------------------------------------------------------------

function JenkinsSection({
  repo,
  branch,
  headSha,
  q
}: {
  repo: Repo;
  branch: string;
  headSha: string;
  q: ReturnType<typeof useJenkinsPRBuilds>;
}) {
  const data = q.data;
  const err = q.error as ApiError | null;
  const count = data?.pipelines.length ?? 0;

  return (
    <section>
      <SectionTitle
        title="Jenkins"
        meta={
          data
            ? `${count} of ${data.linked} linked pipeline${data.linked === 1 ? '' : 's'} built this branch`
            : undefined
        }
      />
      {q.isLoading ? (
        <RowsSkeleton />
      ) : err ? (
        <Notice tone="danger">
          {err.message}{' '}
          {err.code === 'JENKINS_UNAUTHORIZED' && <SetupLink tab="jenkins">Update credentials</SetupLink>}
        </Notice>
      ) : count === 0 ? (
        <Notice>
          None of the linked pipelines has a job for <code className="font-mono text-fg">{branch}</code> yet.
          Jenkins adds branches when it next scans the repository.
        </Notice>
      ) : (
        <ul className="divide-y divide-border-muted overflow-hidden rounded-md border border-border-muted">
          {data!.pipelines.map((p) => (
            <li key={p.jobPath}>
              <JenkinsRow
                p={p}
                headSha={headSha}
                repoId={repo.id}
                branch={branch}
                defaultOpen={p === firstFailed(data!.pipelines)}
              />
            </li>
          ))}
        </ul>
      )}
      {data && data.missing.length > 0 && (
        <div className="mt-2">
          <Notice tone="warn">
            {data.missing.length} linked pipeline{data.missing.length === 1 ? ' no longer exists' : 's no longer exist'} on
            Jenkins. <SetupLink tab="jenkins">Review links</SetupLink>
          </Notice>
        </div>
      )}
      {data && data.errors.length > 0 && (
        <div className="mt-2">
          <Notice tone="warn">
            {data.errors.length} pipeline{data.errors.length === 1 ? '' : 's'} couldn't be loaded:{' '}
            {data.errors[0].message}
          </Notice>
        </div>
      )}
    </section>
  );
}

/** The first pipeline whose latest build failed; it opens by default. */
function firstFailed(list: JenkinsPipelineBuilds[]): JenkinsPipelineBuilds | undefined {
  return list.find((p) => p.builds[0]?.result === 'FAILURE') ?? list.find((p) => p.builds[0]?.result === 'UNSTABLE');
}

function JenkinsRow({
  p,
  headSha,
  repoId,
  branch,
  defaultOpen
}: {
  p: JenkinsPipelineBuilds;
  headSha: string;
  repoId: string;
  branch: string;
  defaultOpen: boolean;
}) {
  const qc = useQueryClient();
  const latest = p.builds[0] ?? null;
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState<'rebuild' | 'stop' | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const running = !!latest?.building;

  useEffect(() => {
    if (!confirmStop) return;
    const t = setTimeout(() => setConfirmStop(false), 3000);
    return () => clearTimeout(t);
  }, [confirmStop]);

  const refreshSoon = () =>
    setTimeout(() => qc.invalidateQueries({ queryKey: ['jenkins', 'pr', repoId, branch] }), 1500);

  async function rebuild() {
    setBusy('rebuild');
    setErr(null);
    try {
      await unwrap(api.integrations.jenkins.triggerBuild(p.branchJobUrl));
      refreshSoon();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    if (!latest) return;
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    setBusy('stop');
    setErr(null);
    try {
      await unwrap(api.integrations.jenkins.stopBuild(latest.url));
      refreshSoon();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  const status: JenkinsBuildResult | 'QUEUED' = p.inQueue && !running ? 'QUEUED' : latest?.result ?? 'UNKNOWN';

  return (
    <div>
      <div
        className="group flex h-11 cursor-default items-center gap-3 px-3 hover:bg-canvas-subtle/50"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        <JenkinsIcon result={status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-fg">{p.label}</span>
            {p.kind === 'pr' && <span className="chip">{p.branchJobName}</span>}
          </div>
        </div>
        {latest && (
          <div className="flex shrink-0 items-center gap-2 text-2xs text-fg-subtle tabular-nums">
            <span className="font-mono text-fg-muted">#{latest.number}</span>
            <span className={cn('font-medium', jenkinsTone(status))}>{jenkinsLabel(status)}</span>
            {running ? <RunningProgress build={latest} /> : <span>{formatDuration(latest.duration)}</span>}
            <ShaChip sha={latest.commitSha ?? null} headSha={headSha} />
            <span className="w-16 text-right">{relativeTime(new Date(latest.timestamp).toISOString())}</span>
          </div>
        )}
        {!latest && p.inQueue && <span className="text-2xs text-attention">Waiting in queue</span>}
        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {running ? (
            <button
              className={cn('btn-ghost h-7 px-2 text-xs', confirmStop && 'text-danger')}
              onClick={() => void stop()}
              disabled={busy !== null}
              title="Abort this build"
            >
              {busy === 'stop' ? <Spinner size="xs" /> : <Square className="h-3 w-3" />}
              {confirmStop ? 'Confirm stop' : 'Stop'}
            </button>
          ) : (
            <button
              className="btn-ghost h-7 px-2 text-xs"
              onClick={() => void rebuild()}
              disabled={busy !== null || p.inQueue}
              title={p.inQueue ? 'A build is already queued' : `Build ${p.branchJobName} again`}
            >
              {busy === 'rebuild' ? <Spinner size="xs" /> : <RotateCw className="h-3 w-3" />}
              Rebuild
            </button>
          )}
          <button
            className="btn-icon h-7 w-7"
            onClick={() => api.shell.openExternal(latest?.url ?? p.branchJobUrl)}
            title="Open in Jenkins"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {err && <div className="px-10 pb-2 text-2xs text-danger">{err}</div>}
      {open && (
        <div className="space-y-3 border-t border-border-muted bg-canvas-inset/40 px-10 py-3">
          {latest ? <JenkinsBuildDetail build={latest} /> : <div className="text-2xs text-fg-subtle">No builds yet.</div>}
          {p.builds.length > 1 && <JenkinsHistory builds={p.builds.slice(1)} headSha={headSha} />}
        </div>
      )}
    </div>
  );
}

function RunningProgress({ build }: { build: JenkinsBuild }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = now - build.timestamp;
  const est = build.estimatedDuration && build.estimatedDuration > 0 ? build.estimatedDuration : null;
  const pct = est ? Math.min(100, (elapsed / est) * 100) : null;
  return (
    <span className="flex items-center gap-1.5" title={est ? `Usually takes ${formatDuration(est)}` : undefined}>
      {pct != null && (
        <span className="h-1 w-14 overflow-hidden rounded-full bg-border-muted">
          <span className="block h-full rounded-full bg-attention" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span>
        {formatDuration(elapsed)}
        {est ? ` / ~${formatDuration(est)}` : ''}
      </span>
    </span>
  );
}

function JenkinsBuildDetail({ build }: { build: JenkinsBuild }) {
  const detailQ = useQuery({
    queryKey: qk.jenkinsBuild(build.url),
    queryFn: () => unwrap(api.integrations.jenkins.getBuild(build.url)),
    staleTime: build.building ? 5_000 : 5 * 60_000,
    refetchInterval: build.building ? 8_000 : false,
    retry: false
  });
  const testsQ = useQuery({
    queryKey: qk.jenkinsTests(build.url),
    queryFn: () => unwrap(api.integrations.jenkins.getTests(build.url)),
    enabled: !build.building,
    staleTime: 5 * 60_000,
    retry: false
  });
  const [showLog, setShowLog] = useState(build.result === 'FAILURE');
  const stages = detailQ.data?.stages ?? [];
  const tests = testsQ.data ?? null;

  return (
    <div className="space-y-3">
      {build.cause && <div className="text-2xs text-fg-subtle">{build.cause}</div>}
      {detailQ.isLoading ? (
        <Skeleton className="h-5 w-2/3" />
      ) : stages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          {stages.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-fg-subtle/50">›</span>}
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-2xs',
                  s.status === 'FAILURE' || s.status === 'UNSTABLE'
                    ? 'border-danger/40 bg-danger/[0.08] text-danger'
                    : 'border-border-muted text-fg-muted'
                )}
                title={formatDuration(s.durationMs)}
              >
                <JenkinsIcon result={s.status} small />
                {s.name}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {tests && tests.total > 0 && (
        <div className="text-2xs">
          <div className="text-fg-muted">
            Tests: <span className={tests.failed > 0 ? 'text-danger' : 'text-success'}>{tests.failed} failed</span> ·{' '}
            {tests.passed} passed{tests.skipped > 0 && ` · ${tests.skipped} skipped`}
          </div>
          {tests.failures.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono">
              {tests.failures.slice(0, 8).map((f, i) => (
                <li key={i} className="truncate text-fg-muted">
                  <span className="text-danger">✕</span> <span className="text-fg-subtle">{f.className}.</span>
                  {f.name}
                </li>
              ))}
              {tests.failures.length > 8 && (
                <li className="text-fg-subtle">+ {tests.failures.length - 8} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {showLog ? (
        <BuildLog buildUrl={build.url} live={build.building} />
      ) : (
        <button className="text-2xs text-accent hover:underline" onClick={() => setShowLog(true)}>
          Show log
        </button>
      )}
    </div>
  );
}

function BuildLog({ buildUrl, live }: { buildUrl: string; live: boolean }) {
  const q = useQuery({
    queryKey: qk.jenkinsLog(buildUrl),
    queryFn: () => unwrap(api.integrations.jenkins.getLog(buildUrl)),
    staleTime: live ? 3_000 : 10 * 60_000,
    refetchInterval: live ? 5_000 : false,
    retry: false
  });
  // The error is almost always at the end.
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [q.data]);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-2xs text-fg-subtle">
        <span>Log (last lines)</span>
        {q.isFetching && <Spinner size="xs" />}
        <button
          className="ml-auto hover:text-fg"
          onClick={() => api.shell.openExternal(`${buildUrl.replace(/\/?$/, '/')}console`)}
        >
          Full log ↗
        </button>
      </div>
      <pre ref={preRef} className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border-muted bg-canvas p-2.5 font-mono text-[11px] leading-[1.45] text-fg-muted">
        {q.isLoading ? 'Loading…' : q.error ? (q.error as ApiError).message : q.data || '(empty)'}
      </pre>
    </div>
  );
}

function JenkinsHistory({ builds, headSha }: { builds: JenkinsBuild[]; headSha: string }) {
  return (
    <div>
      <div className="mb-1 text-2xs text-fg-subtle">Earlier builds</div>
      <ul className="text-2xs">
        {builds.slice(0, 8).map((b) => (
          <li key={b.number}>
            <button
              className="flex h-7 w-full items-center gap-2.5 rounded px-1.5 text-left hover:bg-canvas-subtle"
              onClick={() => api.shell.openExternal(b.url)}
            >
              <JenkinsIcon result={b.result} small />
              <span className="w-10 font-mono text-fg-muted">#{b.number}</span>
              <span className={cn('w-16', jenkinsTone(b.result))}>{jenkinsLabel(b.result)}</span>
              <ShaChip sha={b.commitSha ?? null} headSha={headSha} />
              <span className="min-w-0 flex-1 truncate text-fg-subtle">{b.cause ?? ''}</span>
              <span className="tabular-nums text-fg-subtle">{formatDuration(b.duration)}</span>
              <span className="w-16 text-right tabular-nums text-fg-subtle">
                {relativeTime(new Date(b.timestamp).toISOString())}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function JenkinsIcon({ result, small }: { result: JenkinsBuildResult | 'QUEUED'; small?: boolean }) {
  const cls = cn(small ? 'h-3 w-3' : 'h-4 w-4', 'shrink-0');
  if (result === 'RUNNING') return <Spinner size="xs" className="text-attention" />;
  if (result === 'QUEUED') return <Clock className={cn(cls, 'text-attention')} />;
  if (result === 'SUCCESS') return <CheckCircle2 className={cn(cls, 'text-success')} />;
  if (result === 'FAILURE') return <XCircle className={cn(cls, 'text-danger')} />;
  if (result === 'UNSTABLE') return <AlertTriangle className={cn(cls, 'text-attention')} />;
  if (result === 'ABORTED' || result === 'NOT_BUILT') return <CircleSlash className={cn(cls, 'text-fg-subtle')} />;
  return <CircleDashed className={cn(cls, 'text-fg-subtle')} />;
}

function jenkinsLabel(r: JenkinsBuildResult | 'QUEUED'): string {
  switch (r) {
    case 'RUNNING':
      return 'Running';
    case 'QUEUED':
      return 'Queued';
    case 'SUCCESS':
      return 'Passed';
    case 'FAILURE':
      return 'Failed';
    case 'UNSTABLE':
      return 'Unstable';
    case 'ABORTED':
      return 'Aborted';
    case 'NOT_BUILT':
      return 'Not built';
    default:
      return 'Unknown';
  }
}

function jenkinsTone(r: JenkinsBuildResult | 'QUEUED'): string {
  if (r === 'SUCCESS') return 'text-success';
  if (r === 'FAILURE') return 'text-danger';
  if (r === 'RUNNING' || r === 'QUEUED' || r === 'UNSTABLE') return 'text-attention';
  return 'text-fg-subtle';
}

/** Short SHA; flagged when the build isn't for the PR's current head. */
function ShaChip({ sha, headSha }: { sha: string | null; headSha: string }) {
  if (!sha) return null;
  const outdated = sha !== headSha;
  return (
    <code
      className={cn('font-mono', outdated ? 'text-fg-subtle line-through decoration-fg-subtle/40' : 'text-fg-muted')}
      title={outdated ? `Built ${sha.slice(0, 7)} — not the PR's latest commit` : 'Latest commit'}
    >
      {sha.slice(0, 7)}
    </code>
  );
}

// --- Vercel -------------------------------------------------------------------------

function VercelSection({
  repo,
  headSha,
  q
}: {
  repo: Repo;
  headSha: string;
  q: ReturnType<typeof useVercelPRDeployments>;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const data = q.data;
  const err = q.error as ApiError | null;
  const active = (data?.projects ?? []).filter((p) => p.latest.state !== 'CANCELED');
  const skipped = (data?.projects ?? []).filter((p) => p.latest.state === 'CANCELED');

  return (
    <section>
      <SectionTitle
        title="Vercel"
        meta={
          data
            ? `${active.length} deployment${active.length === 1 ? '' : 's'}${
                skipped.length ? ` · ${skipped.length} skipped` : ''
              }${data.hidden ? ` · ${data.hidden} hidden` : ''}`
            : undefined
        }
      />
      {q.isLoading ? (
        <RowsSkeleton />
      ) : err ? (
        <Notice tone="danger">
          {err.message}{' '}
          {err.code === 'VERCEL_UNAUTHORIZED' && <SetupLink tab="vercel">Update token</SetupLink>}
        </Notice>
      ) : active.length === 0 && skipped.length === 0 ? (
        <Notice>No Vercel project in {repo.label} has deployed this branch.</Notice>
      ) : (
        <ul className="divide-y divide-border-muted overflow-hidden rounded-md border border-border-muted">
          {active.map((p) => (
            <li key={p.projectId}>
              <VercelRow p={p} headSha={headSha} />
            </li>
          ))}
          {skipped.length > 0 && (
            <li>
              <button
                className="flex h-9 w-full items-center gap-3 px-3 text-left text-2xs text-fg-subtle hover:bg-canvas-subtle/50"
                onClick={() => setShowSkipped((s) => !s)}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showSkipped && 'rotate-90')} />
                <CircleSlash className="h-3.5 w-3.5" />
                <span className="truncate">
                  {skipped.length} skipped or canceled — {skipped.map((p) => p.projectName).join(', ')}
                </span>
              </button>
            </li>
          )}
          {showSkipped &&
            skipped.map((p) => (
              <li key={p.projectId}>
                <VercelRow p={p} headSha={headSha} />
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function VercelRow({ p, headSha }: { p: VercelProjectDeployments; headSha: string }) {
  const d = p.latest;
  const [open, setOpen] = useState(d.state === 'ERROR');
  const previewUrl = `https://${d.url}`;
  const inProgress = isVercelActive(d.state);
  return (
    <div>
      <div
        className="flex h-11 cursor-default items-center gap-3 px-3 hover:bg-canvas-subtle/50"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform', open && 'rotate-90')}
        />
        <VercelIcon state={d.state} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-fg">{p.projectName}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-2xs text-fg-subtle tabular-nums">
          <span className={cn('font-medium', vercelTone(d.state))}>{vercelLabel(d.state)}</span>
          <span>{inProgress ? `${formatDuration(Date.now() - (d.buildingAt ?? d.createdAt))}` : deployDuration(d)}</span>
          <ShaChip sha={d.commitSha} headSha={headSha} />
          <span className="w-16 text-right">{relativeTime(new Date(d.createdAt).toISOString())}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn-ghost h-7 px-2 text-xs"
            onClick={() => api.shell.openExternal(previewUrl)}
            disabled={d.state !== 'READY'}
            title={d.state === 'READY' ? previewUrl : 'Preview not ready'}
          >
            <Globe className="h-3 w-3" />
            Visit
          </button>
          <button
            className="btn-icon h-7 w-7"
            onClick={() => api.shell.openExternal(d.inspectorUrl ?? previewUrl)}
            title="Open in Vercel"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border-muted bg-canvas-inset/40 px-10 py-3 text-2xs">
          <div className="flex items-center gap-2 text-fg-subtle">
            <button
              className="truncate font-mono text-fg-muted hover:text-fg hover:underline"
              onClick={() => api.shell.openExternal(previewUrl)}
            >
              {d.url}
            </button>
            {d.creator && <span>· @{d.creator}</span>}
          </div>
          {d.commitMessage && <div className="truncate text-fg-muted">{d.commitMessage}</div>}
          {!p.atHead && (
            <div className="text-attention">No deployment for the PR's latest commit yet — showing the newest one.</div>
          )}
          {p.history.length > 1 && (
            <div>
              <div className="mb-1 mt-2 text-fg-subtle">Earlier deployments</div>
              <ul>
                {p.history
                  .filter((h) => h.uid !== d.uid)
                  .slice(0, 6)
                  .map((h) => (
                    <li key={h.uid}>
                      <button
                        className="flex h-7 w-full items-center gap-2.5 rounded px-1.5 text-left hover:bg-canvas-subtle"
                        onClick={() => api.shell.openExternal(h.inspectorUrl ?? `https://${h.url}`)}
                      >
                        <VercelIcon state={h.state} small />
                        <span className={cn('w-16', vercelTone(h.state))}>{vercelLabel(h.state)}</span>
                        <ShaChip sha={h.commitSha} headSha={headSha} />
                        <span className="min-w-0 flex-1 truncate text-fg-subtle">{h.commitMessage ?? ''}</span>
                        <span className="tabular-nums text-fg-subtle">{deployDuration(h)}</span>
                        <span className="w-16 text-right tabular-nums text-fg-subtle">
                          {relativeTime(new Date(h.createdAt).toISOString())}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function deployDuration(d: VercelDeployment): string {
  if (!d.readyAt) return '—';
  return formatDuration(d.readyAt - (d.buildingAt ?? d.createdAt));
}

function VercelIcon({ state, small }: { state: VercelDeploymentState; small?: boolean }) {
  const cls = cn(small ? 'h-3 w-3' : 'h-4 w-4', 'shrink-0');
  if (isVercelActive(state)) return <Spinner size="xs" className="text-attention" />;
  if (state === 'READY') return <CheckCircle2 className={cn(cls, 'text-success')} />;
  if (state === 'ERROR') return <XCircle className={cn(cls, 'text-danger')} />;
  if (state === 'CANCELED') return <CircleSlash className={cn(cls, 'text-fg-subtle')} />;
  return <CircleDashed className={cn(cls, 'text-fg-subtle')} />;
}

function vercelLabel(s: VercelDeploymentState): string {
  switch (s) {
    case 'READY':
      return 'Ready';
    case 'BUILDING':
      return 'Building';
    case 'INITIALIZING':
      return 'Starting';
    case 'QUEUED':
      return 'Queued';
    case 'ERROR':
      return 'Failed';
    case 'CANCELED':
      return 'Canceled';
    default:
      return 'Unknown';
  }
}

function vercelTone(s: VercelDeploymentState): string {
  if (s === 'READY') return 'text-success';
  if (s === 'ERROR') return 'text-danger';
  if (isVercelActive(s)) return 'text-attention';
  return 'text-fg-subtle';
}

function RowsSkeleton() {
  return (
    <div className="space-y-px overflow-hidden rounded-md border border-border-muted">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-11 items-center gap-3 px-3">
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
