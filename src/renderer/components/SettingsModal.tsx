import { useEffect, useState } from 'react';
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
import type { ClickUpRepoConfig, ClickUpStatus, Repo, SystemTool } from '@shared/types';
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

type TabKey = 'appearance' | 'system' | 'clickup';

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'system', label: 'System', icon: Terminal },
  { key: 'clickup', label: 'ClickUp', icon: Plug }
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
          <RefreshCw className={cn('h-3 w-3', toolsQ.isFetching && 'animate-spin')} />
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
        {tools.map((tool) => (
          <ToolRow key={tool.id} tool={tool} />
        ))}
        {toolsQ.isLoading && (
          <div className="text-2xs text-fg-subtle">Checking system…</div>
        )}
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
