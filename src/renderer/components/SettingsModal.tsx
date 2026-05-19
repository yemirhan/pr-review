import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import type { ClickUpRepoConfig, ClickUpStatus, Repo } from '@shared/types';

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-canvas border border-border rounded-lg w-[720px] max-h-[80vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border-muted flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Settings</h2>
          <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="p-5">
          <ClickUpSection />
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
    { status: 'idle' } | { status: 'testing' } | { status: 'ok'; username: string } | { status: 'err'; message: string }
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
    <section>
      <h3 className="text-sm font-semibold text-fg mb-1">ClickUp</h3>
      <p className="text-2xs text-fg-subtle mb-3">
        Personal API token from{' '}
        <a
          href="https://app.clickup.com/settings/apps"
          onClick={(e) => {
            e.preventDefault();
            api.shell.openExternal('https://app.clickup.com/settings/apps');
          }}
          className="underline hover:text-fg"
        >
          ClickUp → Apps
        </a>
        . Stored locally.
      </p>

      <div className="flex items-center gap-2">
        <input
          type="password"
          placeholder="pk_..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="flex-1 h-8 px-2 bg-canvas-inset border border-border rounded text-sm font-mono text-fg focus:outline-none focus:border-accent"
        />
        <button className="btn" onClick={saveToken} disabled={!token.trim()}>
          {testState.status === 'testing' ? 'Testing…' : 'Save & test'}
        </button>
        {cfgQ.data?.apiToken && (
          <button className="btn" onClick={clearToken}>
            Clear
          </button>
        )}
      </div>
      {testState.status === 'ok' && (
        <div className="mt-2 text-2xs text-success">Connected as {testState.username}</div>
      )}
      {testState.status === 'err' && (
        <div className="mt-2 text-2xs text-danger">{testState.message}</div>
      )}

      {cfgQ.data?.apiToken && (
        <div className="mt-5">
          <TeamSelector
            teams={cfgQ.data.teams ?? []}
            currentTeamId={cfgQ.data.teamId ?? null}
          />
        </div>
      )}

      {cfgQ.data?.apiToken && (
        <div className="mt-6 space-y-4">
          <div className="text-2xs font-semibold uppercase tracking-wider text-fg-subtle">
            Status mapping per repo
          </div>
          {(reposQ.data ?? []).length === 0 && (
            <div className="text-2xs text-fg-subtle">No repos added yet.</div>
          )}
          {(reposQ.data ?? []).map((r) => (
            <RepoMapping key={r.id} repo={r} config={cfgQ.data?.repos[r.id] ?? { statusMap: {} }} />
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
    <div className="rounded-md border border-border-muted p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium text-fg">Workspace</div>
        <button className="btn text-2xs" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="text-2xs text-fg-subtle mb-2">
        Required to look up custom task IDs (the numeric ID in your branch).
      </p>
      <select
        value={currentTeamId ?? ''}
        onChange={(e) => pick(e.target.value)}
        className="w-full h-7 px-2 bg-canvas-inset border border-border rounded text-2xs text-fg focus:outline-none focus:border-accent"
      >
        <option value="">— pick a workspace —</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.id})
          </option>
        ))}
      </select>
      {err && <div className="mt-2 text-2xs text-danger">{err}</div>}
      {!currentTeamId && teams.length === 0 && (
        <div className="mt-2 text-2xs text-fg-subtle">
          No workspaces loaded yet. Click Refresh.
        </div>
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
    <div className="rounded-md border border-border-muted p-3">
      <div className="text-sm font-medium text-fg mb-2">{repo.label}</div>
      <div className="flex items-center gap-2 mb-3">
        <label className="text-2xs text-fg-subtle w-24">List ID</label>
        <input
          type="text"
          placeholder="e.g. 901234567"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          onBlur={() => listId && persist({ listId })}
          className="flex-1 h-7 px-2 bg-canvas-inset border border-border rounded text-2xs font-mono text-fg focus:outline-none focus:border-accent"
        />
      </div>
      {listQ.isError && (
        <div className="text-2xs text-danger mb-2">{(listQ.error as ApiError).message}</div>
      )}
      {statuses.length > 0 && (
        <div className="space-y-2">
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
      {err && <div className="mt-2 text-2xs text-danger">{err}</div>}
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
    <div className="flex items-center gap-2">
      <label className="text-2xs text-fg-subtle w-24">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-7 px-2 bg-canvas-inset border border-border rounded text-2xs text-fg focus:outline-none focus:border-accent"
      >
        <option value="">— none —</option>
        {statuses.map((s) => (
          <option key={s.status} value={s.status}>
            {s.status}
          </option>
        ))}
      </select>
    </div>
  );
}
