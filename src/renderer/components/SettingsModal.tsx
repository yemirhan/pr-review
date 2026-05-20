import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Moon,
  Palette,
  Plug,
  RefreshCw,
  Sun,
  Terminal,
  XCircle
} from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import {
  useUI,
  type Theme,
  type DiffDensity,
  DIFF_FONT_SIZE_MIN,
  DIFF_FONT_SIZE_MAX
} from '../store/ui';
import type {
  ClickUpRepoConfig,
  ClickUpStatus,
  JenkinsPipelineConfig,
  JenkinsRepoConfig,
  Repo,
  SystemTool
} from '@shared/types';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select';
import { cn } from '../lib/cn';
import { Skeleton } from './ui/skeleton';
import { Spinner } from './ui/spinner';

type TabKey = 'appearance' | 'system' | 'clickup' | 'jenkins';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'system', label: 'System', icon: Terminal },
  { key: 'clickup', label: 'ClickUp', icon: Plug },
  { key: 'jenkins', label: 'Jenkins', icon: Plug }
];

const NO_STATUS = '__none__';

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabKey>('appearance');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl w-[760px] h-[560px] max-h-[85vh] p-0 overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-border-muted flex items-center justify-between shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </div>
        <div className="flex-1 flex min-h-0">
          <nav className="w-48 shrink-0 border-r border-border-muted py-3 px-2 bg-canvas-inset/40 space-y-0.5">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors',
                    active
                      ? 'bg-canvas-inset text-fg font-medium'
                      : 'text-fg-muted hover:text-fg hover:bg-canvas-inset/60'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'appearance' && <AppearanceSection />}
            {tab === 'system' && <SystemSection />}
            {tab === 'clickup' && <ClickUpSection />}
            {tab === 'jenkins' && <JenkinsSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="text-2xs text-fg-subtle mt-0.5">{description}</p>}
    </div>
  );
}

function AppearanceSection() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const diffFontSize = useUI((s) => s.diffFontSize);
  const setDiffFontSize = useUI((s) => s.setDiffFontSize);
  const diffDensity = useUI((s) => s.diffDensity);
  const setDiffDensity = useUI((s) => s.setDiffDensity);

  return (
    <section className="space-y-6">
      <SectionHeader
        title="Appearance"
        description="Customize how PR Review looks on your machine."
      />

      <div>
        <Label className="block mb-2">Theme</Label>
        <div className="grid grid-cols-2 gap-2 max-w-sm">
          {(['light', 'dark'] as Theme[]).map((t) => {
            const active = theme === t;
            const Icon = t === 'light' ? Sun : Moon;
            return (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent-subtle/40 text-fg'
                    : 'border-border-muted text-fg-muted hover:text-fg hover:border-border'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="capitalize">{t}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="block mb-2">Code review</Label>
        <div className="rounded-md border border-border-muted p-4 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-fg">Font size</span>
              <span className="text-2xs font-mono text-fg-subtle tabular-nums">
                {diffFontSize}px
              </span>
            </div>
            <input
              type="range"
              min={DIFF_FONT_SIZE_MIN}
              max={DIFF_FONT_SIZE_MAX}
              step={1}
              value={diffFontSize}
              onChange={(e) => setDiffFontSize(parseInt(e.target.value, 10))}
              className="w-full accent-accent"
            />
            <div
              className="mt-2 rounded border border-border-muted bg-canvas-inset/60 px-2 py-1 font-mono text-fg-muted"
              style={{
                fontSize: `${diffFontSize}px`,
                lineHeight: diffDensity === 'comfortable' ? 1.9 : 1.45
              }}
            >
              <div>- const oldValue = compute();</div>
              <div>+ const newValue = compute(input);</div>
            </div>
          </div>

          <div>
            <div className="text-sm text-fg mb-2">Line density</div>
            <div className="grid grid-cols-2 gap-2 max-w-sm">
              {(['compact', 'comfortable'] as DiffDensity[]).map((d) => {
                const active = diffDensity === d;
                return (
                  <button
                    key={d}
                    onClick={() => setDiffDensity(d)}
                    className={cn(
                      'px-3 py-2 rounded-md border text-sm transition-colors text-left',
                      active
                        ? 'border-accent bg-accent-subtle/40 text-fg'
                        : 'border-border-muted text-fg-muted hover:text-fg hover:border-border'
                    )}
                  >
                    <div className="capitalize font-medium">{d}</div>
                    <div className="text-2xs text-fg-subtle mt-0.5">
                      {d === 'compact' ? 'Tight rows' : 'More breathing room'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SystemSection() {
  const qc = useQueryClient();
  const toolsQ = useQuery({
    queryKey: qk.systemTools,
    queryFn: () => unwrap(api.system.tools()),
    staleTime: 30_000
  });

  const tools = toolsQ.data ?? [];
  const missing = tools.filter((t) => !t.installed);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between">
        <SectionHeader
          title="System dependencies"
          description="External CLIs this app shells out to. Install any missing tools to unlock the related features."
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => qc.invalidateQueries({ queryKey: qk.systemTools })}
          disabled={toolsQ.isFetching}
        >
          {toolsQ.isFetching ? (
            <Spinner size="xs" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {toolsQ.isFetching ? 'Checking' : 'Recheck'}
        </Button>
      </div>

      {toolsQ.isError && (
        <div className="text-2xs text-danger">
          Failed to check tools: {(toolsQ.error as ApiError).message}
        </div>
      )}

      {missing.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-2xs text-fg">
          <span className="font-medium text-danger">
            {missing.length} missing {missing.length === 1 ? 'tool' : 'tools'}.
          </span>{' '}
          Install {missing.map((m) => m.label).join(' and ')} to enable all features.
        </div>
      )}

      <div className="space-y-3">
        {toolsQ.isLoading
          ? Array.from({ length: 2 }).map((_, i) => <ToolRowSkeleton key={i} />)
          : tools.map((tool) => <ToolRow key={tool.id} tool={tool} />)}
      </div>
    </section>
  );
}

function ToolRow({ tool }: { tool: SystemTool }) {
  const [copied, setCopied] = useState(false);

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(tool.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        'rounded-md border p-4 space-y-3',
        tool.installed ? 'border-border-muted' : 'border-danger/40 bg-danger/5'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {tool.installed ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : (
            <XCircle className="h-4 w-4 text-danger" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-fg">{tool.label}</span>
            <span className="text-2xs font-mono text-fg-subtle">{tool.id}</span>
            {tool.installed ? (
              <span className="text-2xs text-success">
                Installed{tool.version ? ` · v${tool.version}` : ''}
              </span>
            ) : (
              <span className="text-2xs text-danger">Not found on PATH</span>
            )}
          </div>
          <p className="text-2xs text-fg-subtle mt-0.5">{tool.description}</p>
          {tool.installed && tool.path && (
            <div className="text-2xs font-mono text-fg-subtle mt-1 truncate">{tool.path}</div>
          )}
        </div>
      </div>

      {!tool.installed && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded border border-border-muted bg-canvas-inset px-2 py-1 font-mono text-2xs text-fg overflow-x-auto whitespace-nowrap">
              {tool.installCommand}
            </code>
            <Button variant="ghost" size="sm" onClick={copyCmd}>
              <Copy className="h-3 w-3" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => api.shell.openExternal(tool.installUrl)}
          >
            <ExternalLink className="h-3 w-3" />
            Install instructions
          </Button>
        </div>
      )}
    </div>
  );
}

function ToolRowSkeleton() {
  return (
    <div className="rounded-md border border-border-muted p-4 space-y-3 animate-fade-in">
      <div className="flex items-start gap-3">
        <Skeleton className="h-4 w-4 rounded-full mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-[70%]" />
          <Skeleton className="h-3 w-[55%]" />
        </div>
      </div>
    </div>
  );
}

function ClickUpSection() {
  const qc = useQueryClient();
  const reposQ = useQuery({
    queryKey: qk.repos,
    queryFn: () => unwrap(api.repos.list())
  });
  const cfgQ = useQuery({
    queryKey: qk.clickupConfig,
    queryFn: () => unwrap(api.integrations.clickup.getConfig())
  });

  const [token, setToken] = useState('');
  const [testState, setTestState] = useState<
    | { status: 'idle' }
    | { status: 'testing' }
    | { status: 'ok'; username: string }
    | { status: 'err'; message: string }
  >({ status: 'idle' });

  useEffect(() => {
    if (cfgQ.data?.apiToken) setToken(cfgQ.data.apiToken);
  }, [cfgQ.data?.apiToken]);

  async function saveToken() {
    setTestState({ status: 'testing' });
    try {
      const trimmed = token.trim();
      const res = await unwrap(api.integrations.clickup.testAuth(trimmed));
      await unwrap(api.integrations.clickup.setToken(trimmed || null));
      await qc.invalidateQueries({ queryKey: qk.clickupConfig });
      setTestState({ status: 'ok', username: res.user?.username ?? 'authenticated' });
    } catch (e) {
      setTestState({ status: 'err', message: (e as ApiError).message });
    }
  }

  async function clearToken() {
    await unwrap(api.integrations.clickup.setToken(null));
    setToken('');
    setTestState({ status: 'idle' });
    await qc.invalidateQueries({ queryKey: qk.clickupConfig });
  }

  return (
    <section className="space-y-6">
      <SectionHeader
        title="ClickUp"
        description="Connect your ClickUp workspace to link PRs to tasks."
      />

      <div className="space-y-2">
        <Label htmlFor="clickup-token">API Token</Label>
        <p className="text-2xs text-fg-subtle">
          Personal token from{' '}
          <a
            href="https://app.clickup.com/settings/apps"
            onClick={(e) => {
              e.preventDefault();
              api.shell.openExternal('https://app.clickup.com/settings/apps');
            }}
            className="text-accent hover:underline"
          >
            ClickUp → Apps
          </a>
          . Stored locally.
        </p>
        <div className="flex items-center gap-2">
          <Input
            id="clickup-token"
            type="password"
            placeholder="pk_..."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="flex-1 font-mono text-2xs"
          />
          <Button
            variant="primary"
            onClick={saveToken}
            disabled={!token.trim() || testState.status === 'testing'}
          >
            {testState.status === 'testing' ? 'Testing…' : 'Save & test'}
          </Button>
          {cfgQ.data?.apiToken && (
            <Button variant="ghost" onClick={clearToken}>
              Clear
            </Button>
          )}
        </div>
        {testState.status === 'ok' && (
          <div className="text-2xs text-success">Connected as {testState.username}</div>
        )}
        {testState.status === 'err' && (
          <div className="text-2xs text-danger">{testState.message}</div>
        )}
      </div>

      {cfgQ.data?.apiToken && (
        <TeamSelector teams={cfgQ.data.teams ?? []} currentTeamId={cfgQ.data.teamId ?? null} />
      )}

      {cfgQ.data?.apiToken && (
        <div className="space-y-3">
          <Label>Status mapping per repo</Label>
          {(reposQ.data ?? []).length === 0 && (
            <div className="text-2xs text-fg-subtle">No repos added yet.</div>
          )}
          {(reposQ.data ?? []).map((r) => (
            <RepoMapping
              key={r.id}
              repo={r}
              config={cfgQ.data?.repos[r.id] ?? { statusMap: {} }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamSelector({
  teams,
  currentTeamId
}: {
  teams: { id: string; name: string }[];
  currentTeamId: string | null;
}) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(id: string) {
    setErr(null);
    try {
      await unwrap(api.integrations.clickup.setTeam(id || null));
      await qc.invalidateQueries({ queryKey: qk.clickupConfig });
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setErr(null);
    try {
      await unwrap(api.integrations.clickup.listTeams());
      await qc.invalidateQueries({ queryKey: qk.clickupConfig });
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="rounded-md border border-border-muted p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-fg">Workspace</div>
          <p className="text-2xs text-fg-subtle">
            Required to look up custom task IDs from your branch.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </Button>
      </div>
      <Select value={currentTeamId ?? ''} onValueChange={pick}>
        <SelectTrigger>
          <SelectValue placeholder="— pick a workspace —" />
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}{' '}
              <span className="text-fg-subtle font-mono text-2xs">({t.id})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {err && <div className="text-2xs text-danger">{err}</div>}
      {!currentTeamId && teams.length === 0 && (
        <div className="text-2xs text-fg-subtle">No workspaces loaded yet. Click Refresh.</div>
      )}
    </div>
  );
}

function RepoMapping({ repo, config }: { repo: Repo; config: ClickUpRepoConfig }) {
  const qc = useQueryClient();
  const [listId, setListId] = useState(config.listId ?? '');
  const [map, setMap] = useState(config.statusMap);
  const [err, setErr] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: qk.clickupListStatuses(listId),
    queryFn: () => unwrap(api.integrations.clickup.getListStatuses(listId)),
    enabled: !!listId,
    retry: false
  });

  const statuses: ClickUpStatus[] = listQ.data?.statuses ?? [];

  async function persist(next: Partial<ClickUpRepoConfig>) {
    setErr(null);
    const merged: ClickUpRepoConfig = {
      listId: next.listId ?? (listId || undefined),
      listName: next.listName ?? listQ.data?.name,
      statusMap: { ...map, ...(next.statusMap ?? {}) }
    };
    try {
      await unwrap(api.integrations.clickup.setRepoConfig(repo.id, merged));
      await qc.invalidateQueries({ queryKey: qk.clickupConfig });
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  return (
    <div className="rounded-md border border-border-muted p-4 space-y-3">
      <div className="text-sm font-medium text-fg">{repo.label}</div>
      <div className="space-y-1.5">
        <Label htmlFor={`list-${repo.id}`}>List ID</Label>
        <Input
          id={`list-${repo.id}`}
          type="text"
          placeholder="e.g. 901234567"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          onBlur={() => listId && persist({ listId })}
          className="font-mono text-2xs"
        />
      </div>
      {listQ.isError && (
        <div className="text-2xs text-danger">{(listQ.error as ApiError).message}</div>
      )}
      {statuses.length > 0 && (
        <div className="space-y-2 pt-1">
          <StatusRow
            label="Code review"
            value={map.codeReview ?? ''}
            statuses={statuses}
            onChange={(v) => {
              const next = { ...map, codeReview: v || undefined };
              setMap(next);
              persist({ statusMap: { codeReview: v || undefined } });
            }}
          />
          <StatusRow
            label="Ready for QA"
            value={map.readyForQA ?? ''}
            statuses={statuses}
            onChange={(v) => {
              const next = { ...map, readyForQA: v || undefined };
              setMap(next);
              persist({ statusMap: { readyForQA: v || undefined } });
            }}
          />
          <StatusRow
            label="In progress"
            value={map.inProgress ?? ''}
            statuses={statuses}
            onChange={(v) => {
              const next = { ...map, inProgress: v || undefined };
              setMap(next);
              persist({ statusMap: { inProgress: v || undefined } });
            }}
          />
        </div>
      )}
      {err && <div className="text-2xs text-danger">{err}</div>}
    </div>
  );
}

function StatusRow({
  label,
  value,
  statuses,
  onChange
}: {
  label: string;
  value: string;
  statuses: ClickUpStatus[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <Label className="normal-case tracking-normal text-2xs text-fg-muted font-normal">
        {label}
      </Label>
      <Select
        value={value || NO_STATUS}
        onValueChange={(v) => onChange(v === NO_STATUS ? '' : v)}
      >
        <SelectTrigger className="h-8 text-2xs">
          <SelectValue placeholder="— none —" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_STATUS} className="text-fg-subtle">
            — none —
          </SelectItem>
          {statuses.map((s) => (
            <SelectItem key={s.status} value={s.status}>
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                {s.status}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function JenkinsSection() {
  const qc = useQueryClient();
  const reposQ = useQuery({
    queryKey: qk.repos,
    queryFn: () => unwrap(api.repos.list())
  });
  const cfgQ = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig())
  });

  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [testState, setTestState] = useState<
    | { status: 'idle' }
    | { status: 'testing' }
    | { status: 'ok'; user: string }
    | { status: 'err'; message: string }
  >({ status: 'idle' });

  useEffect(() => {
    if (cfgQ.data) {
      setBaseUrl(cfgQ.data.baseUrl ?? '');
      setUsername(cfgQ.data.username ?? '');
      setToken(cfgQ.data.apiToken ?? '');
    }
  }, [cfgQ.data]);

  const canSave =
    baseUrl.trim().length > 0 && username.trim().length > 0 && token.trim().length > 0;

  async function saveAndTest() {
    setTestState({ status: 'testing' });
    try {
      const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
      const trimmedUser = username.trim();
      const trimmedToken = token.trim();
      const res = await unwrap(
        api.integrations.jenkins.testAuth({
          baseUrl: trimmedUrl,
          username: trimmedUser,
          apiToken: trimmedToken
        })
      );
      await unwrap(api.integrations.jenkins.setBaseUrl(trimmedUrl));
      await unwrap(api.integrations.jenkins.setCredentials(trimmedUser, trimmedToken));
      await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
      setTestState({ status: 'ok', user: res.user ?? trimmedUser });
    } catch (e) {
      setTestState({ status: 'err', message: (e as ApiError).message });
    }
  }

  async function clear() {
    await unwrap(api.integrations.jenkins.setCredentials(null, null));
    await unwrap(api.integrations.jenkins.setBaseUrl(null));
    setBaseUrl('');
    setUsername('');
    setToken('');
    setTestState({ status: 'idle' });
    await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
  }

  const configured = !!cfgQ.data?.apiToken && !!cfgQ.data.baseUrl && !!cfgQ.data.username;

  return (
    <section className="space-y-6">
      <SectionHeader
        title="Jenkins"
        description="Connect a Jenkins server to see build status, history, and trigger rebuilds for a PR's branch."
      />

      <div className="space-y-2">
        <Label htmlFor="jenkins-url">Base URL</Label>
        <Input
          id="jenkins-url"
          type="text"
          placeholder="https://jenkins.internal.company.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="font-mono text-2xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="jenkins-user">Username</Label>
          <Input
            id="jenkins-user"
            type="text"
            placeholder="jdoe"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="font-mono text-2xs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="jenkins-token">API Token</Label>
          <Input
            id="jenkins-token"
            type="password"
            placeholder="11abcdef…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-2xs"
          />
        </div>
      </div>
      <p className="text-2xs text-fg-subtle -mt-3">
        Get an API token from your Jenkins user profile → Configure → API Token. Stored locally.
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={saveAndTest}
          disabled={!canSave || testState.status === 'testing'}
        >
          {testState.status === 'testing' ? 'Testing…' : 'Save & test'}
        </Button>
        {configured && (
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
        {testState.status === 'ok' && (
          <span className="text-2xs text-success">Connected as {testState.user}</span>
        )}
        {testState.status === 'err' && (
          <span className="text-2xs text-danger">{testState.message}</span>
        )}
      </div>

      {configured && (
        <div className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <Label>Per-repo job path</Label>
              <p className="text-2xs text-fg-subtle mt-0.5">
                Paste any Jenkins URL from the pipeline — even a branch URL works.
                The branch is supplied automatically from the PR.
              </p>
            </div>
            <CsvImportButton repos={reposQ.data ?? []} repoConfigs={cfgQ.data?.repos ?? {}} />
          </div>
          {(reposQ.data ?? []).length === 0 && (
            <div className="text-2xs text-fg-subtle">No repos added yet.</div>
          )}
          {(reposQ.data ?? []).map((r) => (
            <JenkinsRepoMapping
              key={r.id}
              repo={r}
              config={cfgQ.data?.repos[r.id] ?? null}
              storedBaseUrl={cfgQ.data?.baseUrl ?? null}
              onBaseUrlDetected={async (url) => {
                setBaseUrl(url);
                await unwrap(api.integrations.jenkins.setBaseUrl(url));
                await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type CsvParseResult =
  | { ok: true; rows: { repoId: string; label: string; jobPath: string }[]; emptyRepoId: number; emptyJobPath: number }
  | { ok: false; reason: 'empty' | 'no-header' | 'missing-columns'; missing?: string[] };

/**
 * Parses a CSV with columns: repo_id (or repo), label, job_path (or jobpath/path).
 * Quoted values supported. Auto-detects comma vs semicolon separator. Strips a
 * leading BOM if Excel added one on save.
 */
function parseCsv(text: string): CsvParseResult {
  const cleaned = text.replace(/^﻿/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: false, reason: 'empty' };
  // Pick whichever separator appears more often on the header row.
  const first = lines[0];
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const parseRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') {
          inQ = false;
        } else {
          cur += c;
        }
      } else if (c === sep) {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur.length === 0) {
        inQ = true;
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = parseRow(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''));
  if (header.length === 0) return { ok: false, reason: 'no-header' };
  const idxRepo = header.findIndex((h) => h === 'repoid' || h === 'repo');
  const idxLabel = header.findIndex((h) => h === 'label' || h === 'name');
  const idxPath = header.findIndex((h) => h === 'jobpath' || h === 'path');
  const missing: string[] = [];
  if (idxRepo < 0) missing.push('repo_id');
  if (idxPath < 0) missing.push('job_path');
  if (missing.length > 0) return { ok: false, reason: 'missing-columns', missing };
  const rows: { repoId: string; label: string; jobPath: string }[] = [];
  let emptyRepoId = 0;
  let emptyJobPath = 0;
  for (const line of lines.slice(1)) {
    const cells = parseRow(line);
    const repoId = (cells[idxRepo] ?? '').trim();
    const jobPath = (cells[idxPath] ?? '').trim().replace(/^\/+|\/+$/g, '');
    const label = idxLabel >= 0 ? (cells[idxLabel] ?? '').trim() : '';
    if (!repoId) {
      emptyRepoId++;
      continue;
    }
    if (!jobPath) {
      emptyJobPath++;
      continue;
    }
    rows.push({ repoId, label: label || jobPath, jobPath });
  }
  return { ok: true, rows, emptyRepoId, emptyJobPath };
}

function CsvImportButton({
  repos,
  repoConfigs
}: {
  repos: Repo[];
  repoConfigs: Record<string, JenkinsRepoConfig>;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setErr(null);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (!parsed.ok) {
        if (parsed.reason === 'empty') setErr('CSV is empty.');
        else if (parsed.reason === 'no-header') setErr('CSV has no header row.');
        else
          setErr(
            `Missing required column${parsed.missing!.length === 1 ? '' : 's'}: ${parsed.missing!.join(', ')}. Header must include repo_id and job_path.`
          );
        return;
      }
      const rows = parsed.rows;
      if (rows.length === 0) {
        if (parsed.emptyRepoId > 0) {
          setErr(
            `All ${parsed.emptyRepoId} rows have an empty repo_id. Fill in the owner/name of the repo each pipeline belongs to (e.g. "7apps/AINotetaker-Android") before importing. The repos you've added to this app are listed below — use those exact ids.`
          );
        } else {
          setErr('No rows with both repo_id and job_path filled in.');
        }
        return;
      }
      const knownRepoIds = new Set(repos.map((r) => r.id));
      const byRepo = new Map<string, { id: string; label: string; jobPath: string }[]>();
      let skipped = 0;
      for (const row of rows) {
        if (!knownRepoIds.has(row.repoId)) {
          skipped++;
          continue;
        }
        const arr = byRepo.get(row.repoId) ?? [];
        arr.push({
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: row.label,
          jobPath: row.jobPath
        });
        byRepo.set(row.repoId, arr);
      }
      let added = 0;
      for (const [repoId, incoming] of byRepo) {
        const existing = repoConfigs[repoId]?.pipelines ?? [];
        const existingPaths = new Set(existing.map((p) => p.jobPath));
        const fresh = incoming.filter((p) => !existingPaths.has(p.jobPath));
        if (fresh.length === 0) continue;
        const merged = [...existing, ...fresh];
        await unwrap(
          api.integrations.jenkins.setRepoConfig(repoId, { pipelines: merged })
        );
        added += fresh.length;
      }
      if (added === 0 && skipped > 0) {
        const sampleKnown = repos.slice(0, 3).map((r) => r.id).join(', ');
        setErr(
          `None of the ${skipped} repo_id values matched a repo in this app. Known repo ids: ${sampleKnown || '(none added)'}${repos.length > 3 ? `, … (${repos.length} total)` : ''}.`
        );
        return;
      }
      await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
      const parts: string[] = [];
      parts.push(`Added ${added} pipeline${added === 1 ? '' : 's'} across ${byRepo.size} repo${byRepo.size === 1 ? '' : 's'}`);
      if (skipped > 0) parts.push(`skipped ${skipped} (no matching repo)`);
      setResult(parts.join(' · '));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          title="Import pipelines from a CSV file"
        >
          Import CSV
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {result && <div className="text-2xs text-success max-w-[280px] text-right">{result}</div>}
      {err && <div className="text-2xs text-danger max-w-[280px] text-right">{err}</div>}
    </div>
  );
}

/**
 * Accepts either a raw Jenkins job path (e.g. `job/Folder/job/Multibranch`) or
 * a full URL pasted from the browser. For multibranch URLs that include a
 * branch segment (`.../job/Multibranch/job/<encodedBranch>/`), the trailing
 * branch is stripped — branches are supplied at runtime from the PR.
 */
function parseJenkinsJobInput(input: string): {
  jobPath: string;
  detectedBaseUrl?: string;
  strippedBranch?: string;
} {
  const trimmed = input.trim();
  if (!trimmed) return { jobPath: '' };

  if (!/^https?:\/\//i.test(trimmed)) {
    return { jobPath: trimmed.replace(/^\/+|\/+$/g, '') };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { jobPath: trimmed };
  }

  const detectedBaseUrl = `${url.protocol}//${url.host}`;
  const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');

  // Job segments live at even indices (0,2,4...) and read "job"; names at odd.
  const jobAnchors = segments
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s === 'job' && x.i % 2 === 0)
    .map((x) => x.i);

  let strippedBranch: string | undefined;
  let resultSegments = segments;

  // Multibranch URL has 2+ "job" anchors and the last name segment IS the
  // branch. Strip it so we store the parent multibranch job only.
  if (jobAnchors.length >= 2) {
    const lastAnchor = jobAnchors[jobAnchors.length - 1];
    if (lastAnchor === segments.length - 2) {
      const raw = segments[lastAnchor + 1];
      // Jenkins double-encodes branch names with slashes in URLs; decode twice
      // to render the human-readable form for the hint.
      try {
        strippedBranch = decodeURIComponent(decodeURIComponent(raw));
      } catch {
        strippedBranch = raw;
      }
      resultSegments = segments.slice(0, lastAnchor);
    }
  }

  return {
    jobPath: resultSegments.join('/'),
    detectedBaseUrl,
    strippedBranch
  };
}

function JenkinsRepoMapping({
  repo,
  config,
  storedBaseUrl,
  onBaseUrlDetected
}: {
  repo: Repo;
  config: JenkinsRepoConfig | null;
  storedBaseUrl: string | null;
  onBaseUrlDetected: (url: string) => void;
}) {
  const qc = useQueryClient();
  const [pipelines, setPipelines] = useState<JenkinsPipelineConfig[]>(
    config?.pipelines ?? []
  );
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [hints, setHints] = useState<Record<string, string>>({});

  useEffect(() => {
    setPipelines(config?.pipelines ?? []);
  }, [config]);

  async function save(next: JenkinsPipelineConfig[]) {
    setErr(null);
    try {
      await unwrap(
        api.integrations.jenkins.setRepoConfig(
          repo.id,
          next.length > 0 ? { pipelines: next } : null
        )
      );
      await qc.invalidateQueries({ queryKey: qk.jenkinsConfig });
      setSavedAt(Date.now());
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  function updateRow(id: string, patch: Partial<JenkinsPipelineConfig>) {
    setPipelines((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function setHint(id: string, hint: string | null) {
    setHints((h) => {
      const next = { ...h };
      if (hint) next[id] = hint;
      else delete next[id];
      return next;
    });
  }

  /**
   * Parse a value pasted/typed into the jobPath field. Accepts a raw path or a
   * Jenkins URL (including branch URLs). Updates the row in place with the
   * extracted path, auto-fills the global base URL if it was empty, and shows
   * a transient hint so the user can verify what was inferred.
   */
  function normalizeJobPath(id: string, raw: string) {
    const parsed = parseJenkinsJobInput(raw);
    if (parsed.jobPath !== raw) {
      updateRow(id, { jobPath: parsed.jobPath });
    }
    if (parsed.detectedBaseUrl && !storedBaseUrl) {
      onBaseUrlDetected(parsed.detectedBaseUrl);
    }
    if (parsed.detectedBaseUrl || parsed.strippedBranch) {
      const parts: string[] = [];
      if (parsed.strippedBranch) parts.push(`branch "${parsed.strippedBranch}" removed`);
      if (parsed.detectedBaseUrl && parsed.detectedBaseUrl !== storedBaseUrl?.replace(/\/+$/, ''))
        parts.push(`base ${parsed.detectedBaseUrl}`);
      if (parts.length > 0) setHint(id, parts.join(' · '));
    }
  }

  function commitRow() {
    const next = pipelines.map((p) => ({
      ...p,
      label: p.label.trim(),
      jobPath: p.jobPath.trim().replace(/^\/+|\/+$/g, '')
    }));
    void save(next);
  }

  function addRow() {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPipelines((prev) => [...prev, { id, label: '', jobPath: '' }]);
  }

  function removeRow(id: string) {
    const next = pipelines.filter((p) => p.id !== id);
    setPipelines(next);
    setHint(id, null);
    void save(next);
  }

  const justSaved = Date.now() - savedAt < 1500;

  return (
    <div className="rounded-md border border-border-muted p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium text-fg">{repo.label}</div>
        {justSaved && <span className="text-2xs text-success">Saved</span>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={addRow}>
          + Add pipeline
        </Button>
      </div>
      {pipelines.length === 0 && (
        <div className="text-2xs text-fg-subtle">
          No pipelines configured. Click <span className="font-medium">Add pipeline</span> to add one.
        </div>
      )}
      {pipelines.map((p) => (
        <div key={p.id} className="space-y-1">
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-center">
            <Input
              type="text"
              placeholder="Label (e.g. API tests)"
              value={p.label}
              onChange={(e) => updateRow(p.id, { label: e.target.value })}
              onBlur={commitRow}
              className="text-2xs"
            />
            <Input
              type="text"
              placeholder="Paste pipeline or branch URL, or job/path"
              value={p.jobPath}
              onChange={(e) => updateRow(p.id, { jobPath: e.target.value })}
              onPaste={(e) => {
                const text = e.clipboardData.getData('text');
                if (text && /^https?:\/\//i.test(text.trim())) {
                  e.preventDefault();
                  normalizeJobPath(p.id, text);
                }
              }}
              onBlur={() => {
                normalizeJobPath(p.id, p.jobPath);
                commitRow();
              }}
              className="font-mono text-2xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeRow(p.id)}
              title="Remove pipeline"
            >
              Remove
            </Button>
          </div>
          {hints[p.id] && (
            <div className="text-2xs text-fg-subtle pl-1">
              <span className="text-success">Detected · </span>
              {hints[p.id]}
            </div>
          )}
        </div>
      ))}
      {err && <div className="text-2xs text-danger">{err}</div>}
    </div>
  );
}
