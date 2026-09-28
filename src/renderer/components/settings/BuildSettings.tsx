import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, RefreshCw, Search, Sparkles } from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Spinner } from '../ui/spinner';
import { Skeleton } from '../ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Disclosure, Group, Page, Row, StatusDot, hostOf } from './primitives';
import type { JenkinsJob, JenkinsPipelineConfig, Repo, VercelProjectLookup } from '@shared/types';

/**
 * Settings → Jenkins and Settings → Vercel. Jenkins pipelines are picked
 * from the server's own list; Vercel projects are matched to repos through
 * their Git link, so there is nothing to type.
 */

function useRepos() {
  return useQuery({ queryKey: qk.repos, queryFn: () => unwrap(api.repos.list()) });
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function useJenkinsStatus() {
  return useQuery({
    queryKey: qk.jenkinsStatus,
    queryFn: () => unwrap(api.integrations.jenkins.status()),
    staleTime: 60_000
  });
}

export function useVercelStatus() {
  return useQuery({
    queryKey: qk.vercelStatus,
    queryFn: () => unwrap(api.integrations.vercel.status()),
    staleTime: 60_000
  });
}

function CheckingRow({ what }: { what: string }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 text-xs text-fg-muted">
      <Spinner size="xs" /> Checking the {what} connection…
    </div>
  );
}

// =====================================================================================
// Jenkins
// =====================================================================================

export function JenkinsSettings() {
  const status = useJenkinsStatus().data;
  return (
    <Page
      title="Jenkins"
      description="See, rebuild and stop the Jenkins builds of a PR's branch from its Builds tab."
    >
      <JenkinsConnection />
      {status?.state === 'ok' && <JenkinsPipelines />}
    </Page>
  );
}

function JenkinsConnection() {
  const qc = useQueryClient();
  const statusQ = useJenkinsStatus();
  const cfgQ = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig())
  });
  const status = statusQ.data;
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setUrl(cfgQ.data?.baseUrl ?? '');
    setUser(cfgQ.data?.username ?? '');
    setToken('');
    setErr(null);
    setEditing(true);
  }

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.jenkinsStatus }),
      qc.invalidateQueries({ queryKey: qk.jenkinsConfig }),
      qc.invalidateQueries({ queryKey: qk.jenkinsJobs }),
      qc.invalidateQueries({ queryKey: ['jenkins', 'pr'] })
    ]);
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const res = await unwrap(
        api.integrations.jenkins.connect({ baseUrl: url, username: user, apiToken: token.trim() || null })
      );
      qc.setQueryData(qk.jenkinsStatus, res);
      await refreshAll();
      setEditing(false);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (statusQ.isLoading) {
    return (
      <Group title="Connection">
        <CheckingRow what="Jenkins" />
      </Group>
    );
  }

  if (editing || status?.state === 'unconfigured') {
    const hasSavedToken = !!cfgQ.data?.apiToken;
    const tokenPage = /^https?:\/\//.test(url.trim()) ? `${url.trim().replace(/\/+$/, '')}/me/configure` : null;
    return (
      <Group title="Connection">
        <Row label="Server URL" htmlFor="jk-url">
          <input
            id="jk-url"
            autoFocus={!url}
            className="input h-7 w-72 font-mono text-2xs"
            placeholder="https://jenkins.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Row>
        <Row label="Username" htmlFor="jk-user">
          <input id="jk-user" className="input h-7 w-72 text-xs" value={user} onChange={(e) => setUser(e.target.value)} />
        </Row>
        <Row
          label="API token"
          htmlFor="jk-token"
          description={
            <>
              Your Jenkins user → Security → API Token
              {tokenPage && (
                <>
                  {' · '}
                  <button className="text-accent hover:underline" onClick={() => api.shell.openExternal(tokenPage)}>
                    Open
                  </button>
                </>
              )}
              . Encrypted with your macOS keychain.
            </>
          }
        >
          <input
            id="jk-token"
            autoFocus={!!url}
            type="password"
            className="input h-7 w-72 font-mono text-2xs"
            placeholder={hasSavedToken ? 'Keep the saved token' : 'Paste a token'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void connect()}
          />
        </Row>
        <div className="flex items-center gap-2 px-4 py-3">
          {err && <span className="min-w-0 flex-1 text-2xs text-danger">{err}</span>}
          <div className="ml-auto flex items-center gap-2">
            {status?.state !== 'unconfigured' && (
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            )}
            <button
              className="btn-primary"
              disabled={busy || !url.trim() || !user.trim() || (!token.trim() && !hasSavedToken)}
              onClick={() => void connect()}
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </Group>
    );
  }

  if (status?.state === 'error') {
    const auth = status.code === 'JENKINS_UNAUTHORIZED';
    return (
      <Group title="Connection">
        <Row
          label={
            <span className="flex items-center gap-2">
              <StatusDot tone="error" />
              {auth ? 'Jenkins rejected the saved token' : "Can't reach Jenkins"}
            </span>
          }
          description={`${[status.username, hostOf(status.baseUrl)].filter(Boolean).join(' · ')} — ${
            auth ? 'it may have expired or been revoked' : status.message
          }`}
        >
          <button className="btn-ghost" onClick={() => void qc.invalidateQueries({ queryKey: qk.jenkinsStatus })}>
            Retry
          </button>
          <button className="btn-primary" onClick={startEdit}>
            Update token
          </button>
        </Row>
      </Group>
    );
  }

  if (status?.state !== 'ok') return null;
  return (
    <Group title="Connection">
      <Row
        label={
          <span className="flex items-center gap-2">
            <StatusDot tone="ok" />
            Connected as {status.user}
          </span>
        }
        description={hostOf(status.baseUrl)}
      >
        <button className="btn-ghost" onClick={startEdit}>
          Change
        </button>
        <button
          className="btn-ghost"
          onClick={async () => {
            await unwrap(api.integrations.jenkins.disconnect());
            await refreshAll();
          }}
        >
          Disconnect
        </button>
      </Row>
    </Group>
  );
}

/** Comparable job path: segments decoded, lowercased, no slashes around. */
function normPath(p: string): string {
  return p
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .join('/')
    .toLowerCase();
}

const normLabel = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

function JenkinsPipelines() {
  const qc = useQueryClient();
  const reposQ = useRepos();
  const cfgQ = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig())
  });
  const jobsQ = useQuery({
    queryKey: qk.jenkinsJobs,
    queryFn: () => unwrap(api.integrations.jenkins.listJobs()),
    staleTime: 5 * 60_000,
    retry: false
  });
  const [refreshing, setRefreshing] = useState(false);
  const [detected, setDetected] = useState<Record<string, string | null> | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectErr, setDetectErr] = useState<string | null>(null);

  async function refreshJobs() {
    setRefreshing(true);
    try {
      qc.setQueryData(qk.jenkinsJobs, await unwrap(api.integrations.jenkins.listJobs(true)));
    } finally {
      setRefreshing(false);
    }
  }

  async function detect() {
    setDetecting(true);
    setDetectErr(null);
    try {
      const res = await unwrap(api.integrations.jenkins.detectJobRepos());
      setDetected(res);
      if (!Object.values(res).some(Boolean)) {
        setDetectErr(
          "Jenkins didn't expose the repositories (reading job config needs Extended Read). Pick pipelines by hand."
        );
      }
    } catch (e) {
      setDetectErr((e as ApiError).message);
    } finally {
      setDetecting(false);
    }
  }

  const repos = reposQ.data ?? [];
  const jobs = jobsQ.data ?? [];

  return (
    <Group
      title="Pipelines"
      description={
        <>
          Link the pipelines that build each repo; a PR shows its branch's builds from every linked pipeline.
          {jobsQ.data && ` ${jobs.length} multibranch pipelines on the server.`}
          {detectErr && <span className="block text-attention">{detectErr}</span>}
        </>
      }
      action={
        <>
          <button
            className="btn-ghost h-7 text-xs"
            onClick={() => void detect()}
            disabled={detecting || jobs.length === 0}
            title="Read each pipeline's configuration to see which GitHub repo it builds"
          >
            {detecting ? <Spinner size="xs" /> : <Sparkles className="h-3.5 w-3.5" />}
            Detect repos
          </button>
          <button className="btn-ghost h-7 text-xs" onClick={() => void refreshJobs()} disabled={refreshing}>
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </>
      }
    >
      {jobsQ.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : jobsQ.error ? (
        <div className="px-4 py-3 text-2xs text-danger">{(jobsQ.error as ApiError).message}</div>
      ) : repos.length === 0 ? (
        <div className="px-4 py-3 text-2xs text-fg-subtle">Add a repository first.</div>
      ) : (
        repos.map((r) => (
          <RepoPipelines
            key={r.id}
            repo={r}
            jobs={jobs}
            linked={cfgQ.data?.repos[r.id]?.pipelines ?? []}
            detected={detected}
          />
        ))
      )}
    </Group>
  );
}

function RepoPipelines({
  repo,
  jobs,
  linked,
  detected
}: {
  repo: Repo;
  jobs: JenkinsJob[];
  linked: JenkinsPipelineConfig[];
  detected: Record<string, string | null> | null;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const repoKey = `${repo.owner}/${repo.name}`.toLowerCase();
  const linkedSet = useMemo(() => new Set(linked.map((p) => normPath(p.jobPath))), [linked]);
  const jobByPath = useMemo(() => new Map(jobs.map((j) => [normPath(j.jobPath), j])), [jobs]);
  const missing = linked.filter((p) => !jobByPath.has(normPath(p.jobPath)));
  const linkedCount = linked.length - missing.length;
  const detectedHere = detected
    ? jobs.filter((j) => detected[j.jobPath] === repoKey && !linkedSet.has(normPath(j.jobPath)))
    : [];
  const linkedElsewhere = detected
    ? linked.filter((p) => {
        const j = jobByPath.get(normPath(p.jobPath));
        const other = j ? detected[j.jobPath] : null;
        return !!other && other !== repoKey;
      })
    : [];

  const q = filter.trim().toLowerCase();
  const shown = jobs.filter(
    (j) =>
      (!onlyLinked || linkedSet.has(normPath(j.jobPath))) &&
      (!q || j.displayName.toLowerCase().includes(q) || (j.folder ?? '').toLowerCase().includes(q))
  );

  async function save(next: JenkinsPipelineConfig[]) {
    setSaving(true);
    setErr(null);
    // Optimistic, so ticking through a long list stays snappy.
    qc.setQueryData(qk.jenkinsConfig, (old: unknown) => {
      const o = old as { repos: Record<string, { pipelines: JenkinsPipelineConfig[] }> } | undefined;
      if (!o) return old;
      const repos = { ...o.repos };
      if (next.length) repos[repo.id] = { pipelines: next };
      else delete repos[repo.id];
      return { ...o, repos };
    });
    try {
      await unwrap(api.integrations.jenkins.setRepoConfig(repo.id, next.length ? { pipelines: next } : null));
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSaving(false);
      await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
      await qc.invalidateQueries({ queryKey: ['jenkins', 'pr', repo.id] });
    }
  }

  const toEntry = (j: JenkinsJob): JenkinsPipelineConfig => ({ id: newId(), label: j.displayName, jobPath: j.jobPath });

  function toggle(j: JenkinsJob, on: boolean) {
    const key = normPath(j.jobPath);
    void save(on ? [...linked, toEntry(j)] : linked.filter((p) => normPath(p.jobPath) !== key));
  }

  function setMany(list: JenkinsJob[], on: boolean) {
    const keys = new Set(list.map((j) => normPath(j.jobPath)));
    if (on) void save([...linked, ...list.filter((j) => !linkedSet.has(normPath(j.jobPath))).map(toEntry)]);
    else void save(linked.filter((p) => !keys.has(normPath(p.jobPath))));
  }

  /** A same-named pipeline that exists, for a linked path that's gone. */
  function replacementFor(p: JenkinsPipelineConfig): JenkinsJob | undefined {
    const l = normLabel(p.label);
    return jobs.find((j) => normLabel(j.displayName) === l && !linkedSet.has(normPath(j.jobPath)));
  }

  return (
    <Disclosure
      title={repo.label}
      meta={
        <>
          <span>{linkedCount > 0 ? `${linkedCount} linked` : 'No pipelines linked'}</span>
          {missing.length > 0 && (
            <span className="flex items-center gap-1 text-attention">
              <AlertTriangle className="h-3 w-3" />
              {missing.length} missing
            </span>
          )}
          {detectedHere.length + linkedElsewhere.length > 0 && (
            <span className="text-accent">{detectedHere.length + linkedElsewhere.length} suggestions</span>
          )}
          {saving && <Spinner size="xs" className="ml-auto" />}
        </>
      }
    >
      {detectedHere.length > 0 && (
        <Suggestion
          icon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
          tone="accent"
          action={
            <button className="btn h-6 text-xs" onClick={() => setMany(detectedHere, true)}>
              Link {detectedHere.length}
            </button>
          }
        >
          {detectedHere.map((j) => j.displayName).join(', ')}{' '}
          {detectedHere.length === 1 ? 'builds' : 'build'} <code className="font-mono">{repoKey}</code> but{' '}
          {detectedHere.length === 1 ? "isn't" : "aren't"} linked.
        </Suggestion>
      )}
      {linkedElsewhere.length > 0 && (
        <Suggestion
          icon={<Sparkles className="h-3.5 w-3.5 text-accent" />}
          tone="accent"
          action={
            <button
              className="btn h-6 text-xs"
              onClick={() => {
                const drop = new Set(linkedElsewhere.map((p) => p.id));
                void save(linked.filter((p) => !drop.has(p.id)));
              }}
            >
              Unlink {linkedElsewhere.length}
            </button>
          }
        >
          {linkedElsewhere.length} linked pipeline{linkedElsewhere.length === 1 ? ' builds' : 's build'} other repos
          (e.g. {linkedElsewhere
            .slice(0, 2)
            .map((p) => `${p.label} → ${detected?.[jobByPath.get(normPath(p.jobPath))!.jobPath]}`)
            .join(', ')}
          ). They only cost requests here.
        </Suggestion>
      )}
      {missing.map((p) => {
        const fix = replacementFor(p);
        return (
          <Suggestion
            key={p.id}
            icon={<AlertTriangle className="h-3.5 w-3.5 text-attention" />}
            tone="warn"
            action={
              <>
                {fix && (
                  <button
                    className="btn h-6 text-xs"
                    onClick={() => void save([...linked.filter((x) => x.id !== p.id), toEntry(fix)])}
                  >
                    Use “{fix.displayName}”
                  </button>
                )}
                <button className="btn-ghost h-6 text-xs" onClick={() => void save(linked.filter((x) => x.id !== p.id))}>
                  Unlink
                </button>
              </>
            }
          >
            <span className="text-fg">{p.label || p.jobPath}</span> isn't on Jenkins anymore
            <code className="ml-1.5 font-mono text-fg-subtle">{p.jobPath}</code>
          </Suggestion>
        );
      })}

      <div className="flex items-center gap-2 px-4 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" />
          <input
            className="input h-7 w-full pl-7 text-xs"
            placeholder={`Filter ${jobs.length} pipelines`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="segmented">
          <button aria-pressed={!onlyLinked} onClick={() => setOnlyLinked(false)}>
            All
          </button>
          <button aria-pressed={onlyLinked} onClick={() => setOnlyLinked(true)}>
            Linked
          </button>
        </div>
        <button className="btn-ghost h-7 text-xs" onClick={() => setMany(shown, true)} disabled={shown.length === 0}>
          Link all
        </button>
        <button className="btn-ghost h-7 text-xs" onClick={() => setMany(shown, false)} disabled={shown.length === 0}>
          Unlink all
        </button>
      </div>

      <ul className="max-h-80 overflow-y-auto border-t border-border-muted py-1">
        {shown.length === 0 && (
          <li className="px-4 py-3 text-2xs text-fg-subtle">{onlyLinked ? 'Nothing linked yet.' : 'No pipelines match.'}</li>
        )}
        {shown.map((j) => {
          const on = linkedSet.has(normPath(j.jobPath));
          const other = detected?.[j.jobPath];
          return (
            <li key={j.jobPath}>
              <label className="group flex h-8 cursor-pointer items-center gap-2.5 px-4 hover:bg-canvas-subtle/60">
                <input type="checkbox" className="accent-accent" checked={on} onChange={(e) => toggle(j, e.target.checked)} />
                <span className={cn('truncate text-xs', on ? 'text-fg' : 'text-fg-muted')}>{j.displayName}</span>
                {j.folder && <span className="truncate text-2xs text-fg-subtle">in {j.folder}</span>}
                {other && other !== repoKey && <span className="truncate text-2xs text-fg-subtle">builds {other}</span>}
                {other === repoKey && !on && <span className="text-2xs text-accent">builds this repo</span>}
                <button
                  className="ml-auto hidden text-fg-subtle hover:text-fg group-hover:block"
                  onClick={(e) => {
                    e.preventDefault();
                    api.shell.openExternal(j.url);
                  }}
                  title="Open in Jenkins"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </label>
            </li>
          );
        })}
      </ul>
      {err && <div className="border-t border-border-muted px-4 py-2 text-2xs text-danger">{err}</div>}
    </Disclosure>
  );
}

function Suggestion({
  icon,
  tone,
  action,
  children
}: {
  icon: React.ReactNode;
  tone: 'accent' | 'warn';
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b border-border-muted px-4 py-2 text-2xs text-fg-muted',
        tone === 'accent' ? 'bg-accent/[0.06]' : 'bg-attention/[0.06]'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      <span className="flex shrink-0 items-center gap-1">{action}</span>
    </div>
  );
}

// =====================================================================================
// Vercel
// =====================================================================================

export function VercelSettings() {
  const status = useVercelStatus().data;
  return (
    <Page title="Vercel" description="Show the preview deployments of a PR's branch in its Builds tab.">
      <VercelConnection />
      {status?.state === 'ok' && <VercelProjects />}
    </Page>
  );
}

const PERSONAL = '__personal__';

function VercelConnection() {
  const qc = useQueryClient();
  const statusQ = useVercelStatus();
  const cfgQ = useQuery({
    queryKey: qk.vercelConfig,
    queryFn: () => unwrap(api.integrations.vercel.getConfig())
  });
  const connected = statusQ.data?.state === 'ok';
  const teamsQ = useQuery({
    queryKey: qk.vercelTeams,
    queryFn: () => unwrap(api.integrations.vercel.listTeams()),
    enabled: connected,
    staleTime: 5 * 60_000
  });
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.vercelStatus }),
      qc.invalidateQueries({ queryKey: qk.vercelConfig }),
      qc.invalidateQueries({ queryKey: qk.vercelTeams }),
      qc.invalidateQueries({ queryKey: qk.vercelProjects }),
      qc.invalidateQueries({ queryKey: ['vercel', 'pr'] })
    ]);
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      await unwrap(api.integrations.vercel.connect(token));
      await refreshAll();
      setEditing(false);
      setToken('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function setTeam(v: string) {
    await unwrap(api.integrations.vercel.setTeamId(v === PERSONAL ? null : v));
    await refreshAll();
  }

  if (statusQ.isLoading) {
    return (
      <Group title="Connection">
        <CheckingRow what="Vercel" />
      </Group>
    );
  }

  const status = statusQ.data;
  if (editing || status?.state === 'unconfigured') {
    return (
      <Group title="Connection">
        <Row
          label="Access token"
          htmlFor="vc-token"
          description={
            <>
              Create one at{' '}
              <button
                className="text-accent hover:underline"
                onClick={() => api.shell.openExternal('https://vercel.com/account/settings/tokens')}
              >
                vercel.com/account/settings/tokens
              </button>{' '}
              with access to your team. Encrypted with your macOS keychain.
            </>
          }
        >
          <input
            id="vc-token"
            autoFocus
            type="password"
            className="input h-7 w-72 font-mono text-2xs"
            placeholder="Paste a token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && void connect()}
          />
        </Row>
        <div className="flex items-center gap-2 px-4 py-3">
          {err && <span className="min-w-0 flex-1 text-2xs text-danger">{err}</span>}
          <div className="ml-auto flex items-center gap-2">
            {status?.state !== 'unconfigured' && (
              <button className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            )}
            <button className="btn-primary" disabled={busy || !token.trim()} onClick={() => void connect()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </Group>
    );
  }

  if (status?.state === 'error') {
    return (
      <Group title="Connection">
        <Row
          label={
            <span className="flex items-center gap-2">
              <StatusDot tone="error" />
              Vercel rejected the saved token
            </span>
          }
          description={status.message}
        >
          <button className="btn-primary" onClick={() => setEditing(true)}>
            Update token
          </button>
        </Row>
      </Group>
    );
  }

  if (status?.state !== 'ok') return null;
  const teams = teamsQ.data ?? [];
  const teamId = cfgQ.data?.teamId ?? null;
  return (
    <Group title="Connection">
      <Row
        label={
          <span className="flex items-center gap-2">
            <StatusDot tone="ok" />
            Connected as {status.user}
          </span>
        }
      >
        <button className="btn-ghost" onClick={() => setEditing(true)}>
          Change
        </button>
        <button
          className="btn-ghost"
          onClick={async () => {
            await unwrap(api.integrations.vercel.disconnect());
            await refreshAll();
          }}
        >
          Disconnect
        </button>
      </Row>
      <Row label="Scope" description="Deployments and projects are read from this team.">
        <Select value={teamId ?? PERSONAL} onValueChange={(v) => void setTeam(v)}>
          <SelectTrigger className="h-7 w-48 text-xs">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PERSONAL}>Personal account</SelectItem>
            {teams.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
            {teamId && !teams.some((t) => t.id === teamId) && <SelectItem value={teamId}>{teamId}</SelectItem>}
          </SelectContent>
        </Select>
      </Row>
    </Group>
  );
}

function VercelProjects() {
  const qc = useQueryClient();
  const reposQ = useRepos();
  const cfgQ = useQuery({
    queryKey: qk.vercelConfig,
    queryFn: () => unwrap(api.integrations.vercel.getConfig())
  });
  const projectsQ = useQuery({
    queryKey: qk.vercelProjects,
    queryFn: () => unwrap(api.integrations.vercel.listProjects()),
    staleTime: 5 * 60_000,
    retry: false
  });
  const [refreshing, setRefreshing] = useState(false);
  const repos = reposQ.data ?? [];
  const projects = projectsQ.data ?? [];
  const repoKeys = new Set(repos.map((r) => `${r.owner}/${r.name}`.toLowerCase()));
  const others = projects.filter((p) => !p.repo || !repoKeys.has(p.repo.toLowerCase())).length;

  async function refresh() {
    setRefreshing(true);
    try {
      qc.setQueryData(qk.vercelProjects, await unwrap(api.integrations.vercel.listProjects(true)));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Group
      title="Projects"
      description={
        <>
          Matched to your repos through their GitHub connection. Untick the ones you don't want on PRs.
          {projectsQ.data && others > 0 && ` ${others} other projects belong to repos you haven't added.`}
        </>
      }
      action={
        <button className="btn-ghost h-7 text-xs" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Refresh
        </button>
      }
    >
      {projectsQ.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      ) : projectsQ.error ? (
        <div className="px-4 py-3 text-2xs text-danger">{(projectsQ.error as ApiError).message}</div>
      ) : (
        repos.map((r) => (
          <RepoProjects
            key={r.id}
            repo={r}
            projects={projects.filter((p) => p.repo?.toLowerCase() === `${r.owner}/${r.name}`.toLowerCase())}
            hidden={cfgQ.data?.hiddenProjects ?? []}
          />
        ))
      )}
    </Group>
  );
}

function RepoProjects({ repo, projects, hidden }: { repo: Repo; projects: VercelProjectLookup[]; hidden: string[] }) {
  const qc = useQueryClient();
  const hiddenSet = new Set(hidden);
  const hiddenHere = projects.filter((p) => hiddenSet.has(p.id)).length;

  async function setHidden(id: string, h: boolean) {
    qc.setQueryData(qk.vercelConfig, (old: unknown) => {
      const o = old as { hiddenProjects: string[] } | undefined;
      if (!o) return old;
      const next = new Set(o.hiddenProjects);
      if (h) next.add(id);
      else next.delete(id);
      return { ...o, hiddenProjects: [...next] };
    });
    await unwrap(api.integrations.vercel.setProjectHidden(id, h));
    await qc.invalidateQueries({ queryKey: qk.vercelConfig });
    await qc.invalidateQueries({ queryKey: ['vercel', 'pr', repo.id] });
  }

  return (
    <Disclosure
      title={repo.label}
      disabled={projects.length === 0}
      meta={
        projects.length === 0
          ? 'No Vercel projects'
          : `${projects.length - hiddenHere} of ${projects.length} project${projects.length === 1 ? '' : 's'} shown`
      }
    >
      <ul className="max-h-80 overflow-y-auto py-1">
        {projects.map((p) => (
          <li key={p.id}>
            <label className="flex h-8 cursor-pointer items-center gap-2.5 px-4 hover:bg-canvas-subtle/60">
              <input
                type="checkbox"
                className="accent-accent"
                checked={!hiddenSet.has(p.id)}
                onChange={(e) => void setHidden(p.id, !e.target.checked)}
              />
              <span className={cn('truncate text-xs', hiddenSet.has(p.id) ? 'text-fg-subtle' : 'text-fg')}>{p.name}</span>
              {p.rootDirectory && <code className="truncate font-mono text-2xs text-fg-subtle">{p.rootDirectory}</code>}
              {p.framework && <span className="ml-auto text-2xs text-fg-subtle">{p.framework}</span>}
            </label>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
