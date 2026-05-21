import { useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  ExternalLink,
  Eye,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../ui/spinner';
import type {
  Repo,
  VercelDeployment,
  VercelDeploymentState,
  VercelProjectConfig
} from '@shared/types';

export function VercelDeploymentsTab({ repo, branch }: { repo: Repo; branch: string }) {
  const cfgQ = useQuery({
    queryKey: qk.vercelConfig,
    queryFn: () => unwrap(api.integrations.vercel.getConfig()),
    staleTime: 30_000
  });

  const configured = !!cfgQ.data?.token;
  const projects = cfgQ.data?.repos[repo.id]?.projects ?? [];

  if (!configured) {
    return (
      <EmptyState
        title="Vercel not configured"
        body="Add your Vercel API token in Settings → Vercel to see preview deployment status here."
      />
    );
  }
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects mapped"
        body={`Add one or more Vercel projects for ${repo.label} in Settings → Vercel.`}
      />
    );
  }

  const probes = useQueries({
    queries: projects.map((p) => ({
      queryKey: qk.vercelDeployments(p.projectId, branch),
      queryFn: () =>
        unwrap(api.integrations.vercel.listDeployments(p.projectId, branch, 20)),
      staleTime: 10_000,
      retry: false
    }))
  });

  const allLoading = probes.every((q) => q.isLoading);
  const visible = projects.filter((_, i) => {
    const q = probes[i];
    if (q.isLoading) return true;
    if (q.error) return false;
    return (q.data?.length ?? 0) > 0;
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-5 py-3 border-b border-border-muted text-2xs text-fg-subtle sticky top-0 bg-canvas/95 backdrop-blur z-10">
        <span className="font-mono">{branch}</span> · {visible.length}
        {visible.length !== projects.length && (
          <span className="text-fg-subtle/60"> / {projects.length}</span>
        )}{' '}
        {visible.length === 1 ? 'project' : 'projects'} with deployments
      </div>
      <div className="p-5 space-y-5">
        {allLoading ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No deployments for this branch"
            body={`None of the ${projects.length} mapped Vercel projects have a preview deployment for ${branch} yet. Push a commit to trigger one.`}
          />
        ) : (
          visible.map((p) => (
            <ProjectSection key={p.id} project={p} branch={branch} />
          ))
        )}
      </div>
    </div>
  );
}

function ProjectSection({
  project,
  branch
}: {
  project: VercelProjectConfig;
  branch: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.vercelDeployments(project.projectId, branch),
    queryFn: () =>
      unwrap(api.integrations.vercel.listDeployments(project.projectId, branch, 20)),
    refetchInterval: (query) => {
      const data = query.state.data as VercelDeployment[] | undefined;
      return data && data.some((d) => isInProgress(d.state)) ? 10_000 : false;
    },
    staleTime: 10_000,
    retry: false
  });

  const deployments = q.data ?? [];
  const latest = deployments[0] ?? null;
  const label = project.label.trim() || project.projectId;

  let body: React.ReactNode;
  if (q.isLoading) {
    body = <Skeleton className="h-14 w-full rounded-md" />;
  } else if (q.error) {
    body = (
      <div className="text-2xs text-danger">{(q.error as ApiError).message}</div>
    );
  } else if (!latest) {
    body = <div className="text-2xs text-fg-subtle">No deployments for this branch yet.</div>;
  } else {
    body = <LatestRow deployment={latest} />;
  }

  return (
    <section className={cn('rounded-md border overflow-hidden', latest ? toneBorder(latest.state) : 'border-border-muted')}>
      <header className="px-3 py-2 border-b border-border-muted bg-canvas-inset/50 flex items-center gap-2">
        <span className="text-sm font-medium text-fg">{label}</span>
        <code className="text-2xs text-fg-subtle font-mono truncate" title={project.projectId}>
          {project.projectId}
        </code>
        <div className="ml-auto flex items-center gap-1.5">
          {q.isFetching && <Spinner size="xs" />}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: qk.vercelDeployments(project.projectId, branch) })
            }
            disabled={q.isFetching}
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </header>
      <div className="px-3 py-3">{body}</div>
      {deployments.length > 1 && <HistoryTable deployments={deployments} />}
    </section>
  );
}

function LatestRow({ deployment }: { deployment: VercelDeployment }) {
  const previewUrl = `https://${deployment.url}`;
  return (
    <div className="flex items-start gap-3">
      <StateIcon state={deployment.state} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <StateBadge state={deployment.state} />
          <span className="text-2xs text-fg-subtle">
            {relativeTime(new Date(deployment.createdAt).toISOString())}
          </span>
          <span className="text-2xs text-fg-subtle font-mono tabular-nums">
            ·{' '}
            {formatDuration(
              (deployment.readyAt ?? Date.now()) -
                (deployment.buildingAt ?? deployment.createdAt)
            )}
          </span>
          {deployment.commitSha && (
            <span className="text-2xs text-fg-subtle">
              · <code className="text-fg-muted">{deployment.commitSha.slice(0, 7)}</code>
            </span>
          )}
          {deployment.creator && (
            <span className="text-2xs text-fg-subtle">· @{deployment.creator}</span>
          )}
        </div>
        {deployment.commitMessage && (
          <div className="text-2xs text-fg-subtle mt-0.5 truncate">
            {deployment.commitMessage}
          </div>
        )}
        <div className="text-2xs text-fg-subtle mt-1 font-mono truncate">
          {deployment.url}
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button
          variant="primary"
          size="sm"
          onClick={() => api.shell.openExternal(previewUrl)}
          disabled={deployment.state !== 'READY'}
          title={deployment.state === 'READY' ? 'Open preview' : 'Preview not ready'}
        >
          <ExternalLink className="h-3 w-3" />
          Visit
        </Button>
        {deployment.inspectorUrl && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => api.shell.openExternal(deployment.inspectorUrl!)}
            title="Open deployment dashboard"
          >
            <Eye className="h-3 w-3" />
            Inspect
          </Button>
        )}
      </div>
    </div>
  );
}

function HistoryTable({ deployments }: { deployments: VercelDeployment[] }) {
  const rows = useMemo(() => deployments.slice(1, 20), [deployments]);
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-border-muted">
      <header className="px-3 py-1.5 border-b border-border-muted text-2xs font-medium text-fg-muted uppercase tracking-wide">
        Earlier deployments
      </header>
      <ul className="divide-y divide-border-muted">
        {rows.map((d) => {
          const previewUrl = `https://${d.url}`;
          return (
            <li key={d.uid}>
              <a
                href={previewUrl}
                onClick={(e) => {
                  e.preventDefault();
                  api.shell.openExternal(d.inspectorUrl ?? previewUrl);
                }}
                className="flex items-center gap-3 px-3 py-1.5 hover:bg-canvas-subtle/60 cursor-pointer transition-colors"
              >
                <StateIcon state={d.state} />
                <span className="flex-1 min-w-0 text-2xs text-fg-subtle truncate">
                  {d.commitMessage ?? d.url}
                  {d.commitSha ? ` · ${d.commitSha.slice(0, 7)}` : ''}
                </span>
                <span className="text-2xs text-fg-subtle font-mono tabular-nums shrink-0 text-right">
                  <div>
                    {formatDuration(
                      (d.readyAt ?? d.createdAt) - (d.buildingAt ?? d.createdAt)
                    )}
                  </div>
                  <div>{relativeTime(new Date(d.createdAt).toISOString())}</div>
                </span>
                <ExternalLink className="h-3 w-3 text-fg-subtle shrink-0" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StateIcon({ state }: { state: VercelDeploymentState }) {
  const cls = 'h-4 w-4 shrink-0';
  if (isInProgress(state)) return <Spinner size="xs" className="text-attention" />;
  if (state === 'READY') return <CheckCircle2 className={cn(cls, 'text-success')} />;
  if (state === 'ERROR') return <XCircle className={cn(cls, 'text-danger')} />;
  if (state === 'CANCELED') return <CircleSlash className={cn(cls, 'text-fg-subtle')} />;
  return <CircleDashed className={cn(cls, 'text-fg-subtle')} />;
}

function StateBadge({ state }: { state: VercelDeploymentState }) {
  const label =
    state === 'READY'
      ? 'ready'
      : state === 'BUILDING'
        ? 'building'
        : state === 'INITIALIZING'
          ? 'initializing'
          : state === 'QUEUED'
            ? 'queued'
            : state === 'ERROR'
              ? 'failed'
              : state === 'CANCELED'
                ? 'canceled'
                : 'unknown';
  return <span className={cn('text-2xs font-medium', toneText(state))}>{label}</span>;
}

function isInProgress(state: VercelDeploymentState): boolean {
  return state === 'BUILDING' || state === 'INITIALIZING' || state === 'QUEUED';
}

function toneText(s: VercelDeploymentState): string {
  if (s === 'READY') return 'text-success';
  if (s === 'ERROR') return 'text-danger';
  if (isInProgress(s)) return 'text-attention';
  return 'text-fg-subtle';
}

function toneBorder(s: VercelDeploymentState): string {
  if (s === 'READY') return 'border-success/40';
  if (s === 'ERROR') return 'border-danger/40';
  if (isInProgress(s)) return 'border-attention/40';
  return 'border-border-muted';
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
