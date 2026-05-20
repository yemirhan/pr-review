import { useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  ExternalLink,
  RefreshCw,
  Rocket,
  XCircle
} from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import type {
  JenkinsBuild,
  JenkinsBuildResult,
  JenkinsPipelineConfig,
  JenkinsTestSummary,
  Repo
} from '@shared/types';

export function JenkinsBuildsTab({ repo, branch }: { repo: Repo; branch: string }) {
  const cfgQ = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig()),
    staleTime: 30_000
  });

  const configured =
    !!cfgQ.data?.baseUrl && !!cfgQ.data.username && !!cfgQ.data.apiToken;
  const pipelines = cfgQ.data?.repos[repo.id]?.pipelines ?? [];

  if (!configured) {
    return (
      <EmptyState
        title="Jenkins not configured"
        body="Add your Jenkins base URL and API token in Settings → Jenkins to see build status here."
      />
    );
  }
  if (pipelines.length === 0) {
    return (
      <EmptyState
        title="No pipelines mapped"
        body={`Add one or more Jenkins pipelines for ${repo.label} in Settings → Jenkins.`}
      />
    );
  }

  // Probe each pipeline in parallel to decide which ones actually have a build
  // for this branch. The same query key is used inside PipelineSection, so this
  // doesn't trigger a second network request — it just lets us filter before
  // rendering.
  const probes = useQueries({
    queries: pipelines.map((p) => ({
      queryKey: qk.jenkinsBuilds(p.jobPath, branch),
      queryFn: () =>
        unwrap(api.integrations.jenkins.listBuilds(p.jobPath, branch, 20)),
      staleTime: 10_000,
      retry: false
    }))
  });

  const allLoading = probes.every((q) => q.isLoading);
  const visiblePipelines = pipelines.filter((_, i) => {
    const q = probes[i];
    if (q.isLoading) return true;
    if (q.error) return false; // 404 / network — hide
    return (q.data?.length ?? 0) > 0;
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-5 py-3 border-b border-border-muted text-2xs text-fg-subtle sticky top-0 bg-canvas/95 backdrop-blur z-10">
        <span className="font-mono">{branch}</span> · {visiblePipelines.length}
        {visiblePipelines.length !== pipelines.length && (
          <span className="text-fg-subtle/60"> / {pipelines.length}</span>
        )}{' '}
        {visiblePipelines.length === 1 ? 'pipeline' : 'pipelines'} with builds
      </div>
      <div className="p-5 space-y-5">
        {allLoading ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : visiblePipelines.length === 0 ? (
          <EmptyState
            title="No builds for this branch"
            body={`None of the ${pipelines.length} mapped Jenkins pipelines have a build for ${branch} yet.`}
          />
        ) : (
          visiblePipelines.map((p) => (
            <PipelineSection key={p.id} pipeline={p} branch={branch} />
          ))
        )}
      </div>
    </div>
  );
}

function PipelineSection({
  pipeline,
  branch
}: {
  pipeline: JenkinsPipelineConfig;
  branch: string;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const buildsQ = useQuery({
    queryKey: qk.jenkinsBuilds(pipeline.jobPath, branch),
    queryFn: () =>
      unwrap(api.integrations.jenkins.listBuilds(pipeline.jobPath, branch, 20)),
    refetchInterval: (q) => {
      const data = q.state.data as JenkinsBuild[] | undefined;
      return data && data.some((b) => b.building) ? 10_000 : false;
    },
    staleTime: 10_000,
    retry: false
  });

  const latest = buildsQ.data?.[0] ?? null;
  const latestFailed =
    !!latest && (latest.result === 'FAILURE' || latest.result === 'UNSTABLE');

  const buildQ = useQuery({
    queryKey: latest
      ? qk.jenkinsBuild(pipeline.jobPath, branch, latest.number)
      : ['no-jenkins-build', pipeline.id],
    queryFn: () =>
      unwrap(api.integrations.jenkins.getBuild(pipeline.jobPath, branch, latest!.number)),
    enabled: !!latest && latestFailed,
    retry: false,
    staleTime: 30_000
  });

  const testsQ = useQuery({
    queryKey: latest
      ? qk.jenkinsTests(pipeline.jobPath, branch, latest.number)
      : ['no-jenkins-tests', pipeline.id],
    queryFn: () =>
      unwrap(api.integrations.jenkins.getTests(pipeline.jobPath, branch, latest!.number)),
    enabled: !!latest && latestFailed,
    retry: false,
    staleTime: 30_000
  });

  const [triggering, setTriggering] = useState(false);
  const [triggerErr, setTriggerErr] = useState<string | null>(null);

  async function rebuild() {
    setTriggering(true);
    setTriggerErr(null);
    try {
      await unwrap(api.integrations.jenkins.triggerBuild(pipeline.jobPath, branch));
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: qk.jenkinsBuilds(pipeline.jobPath, branch) });
      }, 1500);
    } catch (e) {
      setTriggerErr((e as ApiError).message);
    } finally {
      setTriggering(false);
    }
  }

  const prettyPath = prettyJobPath(pipeline.jobPath);
  const label = pipeline.label.trim() || prettyPath;
  const running = (buildsQ.data ?? []).some((b) => b.building);

  let body: React.ReactNode;
  if (buildsQ.isLoading) {
    body = <Skeleton className="h-14 w-full rounded-md" />;
  } else if (buildsQ.error) {
    const err = buildsQ.error as ApiError;
    if (err.code === 'JENKINS_NOT_FOUND') {
      body = (
        <div className="text-2xs text-fg-subtle">
          No Jenkins build for branch{' '}
          <code className="text-fg-muted">{branch}</code> in this pipeline yet.
        </div>
      );
    } else {
      body = <div className="text-2xs text-danger">{err.message}</div>;
    }
  } else if (!latest) {
    body = <div className="text-2xs text-fg-subtle">No builds for this branch yet.</div>;
  } else {
    body = <LatestRow build={latest} />;
  }

  const builds = buildsQ.data ?? [];

  return (
    <section
      className={cn(
        'rounded-md border overflow-hidden',
        latest ? toneBorder(latest.result) : 'border-border-muted'
      )}
    >
      <header className="px-3 py-2 border-b border-border-muted bg-canvas-inset/50 flex items-center gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-fg hover:text-fg"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-fg-subtle" />
          ) : (
            <ChevronRight className="h-3 w-3 text-fg-subtle" />
          )}
          <span className="text-sm font-medium">{label}</span>
        </button>
        <code className="text-2xs text-fg-subtle font-mono truncate" title={pipeline.jobPath}>
          {prettyPath}
        </code>
        <div className="ml-auto flex items-center gap-1.5">
          {buildsQ.isFetching && <Spinner size="xs" />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: qk.jenkinsBuilds(pipeline.jobPath, branch) })
            }
            disabled={buildsQ.isFetching}
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={rebuild}
            disabled={triggering || running || !!buildsQ.error}
            title={running ? 'A build is already running' : 'Trigger a new build'}
          >
            <Rocket className="h-3 w-3" />
            {triggering ? 'Triggering…' : running ? 'Running' : 'Rebuild'}
          </Button>
        </div>
      </header>

      <div className="px-3 py-3">{body}</div>

      {triggerErr && (
        <div className="px-3 pb-2 text-2xs text-danger">{triggerErr}</div>
      )}

      {expanded && latest && (
        <div className="border-t border-border-muted">
          {latestFailed && (
            <FailedDetail
              stages={buildQ.data?.stages ?? []}
              tests={testsQ.data ?? null}
              loading={buildQ.isLoading || testsQ.isLoading}
            />
          )}
          {builds.length > 0 && <HistoryTable builds={builds} />}
        </div>
      )}
    </section>
  );
}

function LatestRow({ build }: { build: JenkinsBuild }) {
  return (
    <div className="flex items-center gap-3">
      <ResultIcon result={build.result} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-fg">#{build.number}</span>
          <ResultBadge result={build.result} />
          <span className="text-2xs text-fg-subtle">
            {relativeTime(new Date(build.timestamp).toISOString())}
          </span>
          <span className="text-2xs text-fg-subtle font-mono tabular-nums">
            ·{' '}
            {formatDuration(
              build.duration || (build.building ? Date.now() - build.timestamp : 0)
            )}
          </span>
          {build.commitSha && (
            <span className="text-2xs text-fg-subtle">
              · <code className="text-fg-muted">{build.commitSha.slice(0, 7)}</code>
            </span>
          )}
        </div>
        {build.cause && (
          <div className="text-2xs text-fg-subtle mt-0.5 truncate">{build.cause}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => api.shell.openExternal(build.url)}
        title="Open in Jenkins"
      >
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}

function FailedDetail({
  stages,
  tests,
  loading
}: {
  stages: { id: string; name: string; status: JenkinsBuildResult; durationMs: number }[];
  tests: JenkinsTestSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="p-3 space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  }
  if (stages.length === 0 && !tests) return null;
  return (
    <div>
      {stages.length > 0 && (
        <div>
          <header className="px-3 py-1.5 border-b border-border-muted text-2xs font-medium text-fg-muted uppercase tracking-wide">
            Pipeline stages
          </header>
          <ul className="divide-y divide-border-muted">
            {stages.map((s) => (
              <li
                key={s.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-1.5 text-sm',
                  s.status === 'FAILURE' && 'bg-danger-subtle/30'
                )}
              >
                <ResultIcon result={s.status} />
                <span className="flex-1 truncate text-fg">{s.name}</span>
                <span className="text-2xs text-fg-subtle font-mono tabular-nums">
                  {formatDuration(s.durationMs)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tests && tests.total > 0 && (
        <div className="border-t border-border-muted">
          <header className="px-3 py-1.5 border-b border-border-muted text-2xs font-medium text-fg-muted uppercase tracking-wide flex items-center gap-3">
            <span>Tests</span>
            <span className="font-normal normal-case tracking-normal">
              <span className={tests.failed > 0 ? 'text-danger' : 'text-success'}>
                {tests.failed} failed
              </span>{' '}
              · {tests.passed} passed
              {tests.skipped > 0 && ` · ${tests.skipped} skipped`}
            </span>
          </header>
          {tests.failures.length > 0 && (
            <ul className="divide-y divide-border-muted">
              {tests.failures.slice(0, 5).map((f, i) => (
                <li key={i} className="px-3 py-1 text-2xs font-mono text-fg-muted">
                  <span className="text-danger">✕</span>{' '}
                  <span className="text-fg-subtle">{f.className}</span>
                  <span className="text-fg-subtle">.</span>
                  <span className="text-fg">{f.name}</span>
                </li>
              ))}
              {tests.failures.length > 5 && (
                <li className="px-3 py-1 text-2xs text-fg-subtle">
                  + {tests.failures.length - 5} more
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryTable({ builds }: { builds: JenkinsBuild[] }) {
  const rows = useMemo(() => builds.slice(0, 20), [builds]);
  return (
    <div className="border-t border-border-muted">
      <header className="px-3 py-1.5 border-b border-border-muted text-2xs font-medium text-fg-muted uppercase tracking-wide">
        Recent builds
      </header>
      <ul className="divide-y divide-border-muted">
        {rows.map((b) => (
          <li key={b.number}>
            <a
              href={b.url}
              onClick={(e) => {
                e.preventDefault();
                api.shell.openExternal(b.url);
              }}
              className="flex items-center gap-3 px-3 py-1.5 hover:bg-canvas-subtle/60 cursor-pointer transition-colors"
            >
              <ResultIcon result={b.result} />
              <span className="text-sm font-mono text-fg w-12 shrink-0">#{b.number}</span>
              <span className="flex-1 min-w-0 text-2xs text-fg-subtle truncate">
                {b.cause ?? '—'}
                {b.commitSha ? ` · ${b.commitSha.slice(0, 7)}` : ''}
              </span>
              <span className="text-2xs text-fg-subtle font-mono tabular-nums shrink-0 text-right">
                <div>
                  {formatDuration(
                    b.duration || (b.building ? Date.now() - b.timestamp : 0)
                  )}
                </div>
                <div>{relativeTime(new Date(b.timestamp).toISOString())}</div>
              </span>
              <ExternalLink className="h-3 w-3 text-fg-subtle shrink-0" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultIcon({ result }: { result: JenkinsBuildResult }) {
  const cls = 'h-4 w-4 shrink-0';
  if (result === 'RUNNING') return <Spinner size="xs" className="text-attention" />;
  if (result === 'SUCCESS') return <CheckCircle2 className={cn(cls, 'text-success')} />;
  if (result === 'FAILURE' || result === 'UNSTABLE')
    return <XCircle className={cn(cls, 'text-danger')} />;
  if (result === 'ABORTED' || result === 'NOT_BUILT')
    return <CircleSlash className={cn(cls, 'text-fg-subtle')} />;
  return <CircleDashed className={cn(cls, 'text-fg-subtle')} />;
}

function ResultBadge({ result }: { result: JenkinsBuildResult }) {
  const label =
    result === 'RUNNING'
      ? 'running'
      : result === 'SUCCESS'
        ? 'passed'
        : result === 'FAILURE'
          ? 'failed'
          : result === 'UNSTABLE'
            ? 'unstable'
            : result === 'ABORTED'
              ? 'aborted'
              : result === 'NOT_BUILT'
                ? 'not built'
                : 'unknown';
  return <span className={cn('text-2xs font-medium', toneText(result))}>{label}</span>;
}

function toneText(r: JenkinsBuildResult): string {
  if (r === 'SUCCESS') return 'text-success';
  if (r === 'FAILURE' || r === 'UNSTABLE') return 'text-danger';
  if (r === 'RUNNING') return 'text-attention';
  return 'text-fg-subtle';
}

function toneBorder(r: JenkinsBuildResult): string {
  if (r === 'SUCCESS') return 'border-success/40';
  if (r === 'FAILURE' || r === 'UNSTABLE') return 'border-danger/40';
  if (r === 'RUNNING') return 'border-attention/40';
  return 'border-border-muted';
}

/** Decode a Jenkins job path for display, e.g. `job/Lens%20ID%20-%20iOS` → `Lens ID - iOS`. */
function prettyJobPath(raw: string): string {
  const cleaned = raw.replace(/^\/+|\/+$/g, '');
  const parts = cleaned.split('/');
  const names = parts.filter((_, i) => i % 2 === 1);
  if (names.length === 0) return raw;
  try {
    return names.map((n) => decodeURIComponent(n)).join(' / ');
  } catch {
    return raw;
  }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-8 flex flex-col items-start gap-2 max-w-xl">
      <div className="text-sm font-medium text-fg">{title}</div>
      <p className="text-2xs text-fg-subtle">{body}</p>
    </div>
  );
}
