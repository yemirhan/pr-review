import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { Spinner } from '../ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Group, Page, Row, StatusDot } from './primitives';

export function useClickUpStatus() {
  return useQuery({
    queryKey: qk.clickupStatus,
    queryFn: () => unwrap(api.integrations.clickup.status()),
    staleTime: 60_000
  });
}

/**
 * Settings → ClickUp. A PR links to a task when its branch name carries the
 * task's ID; all this needs is a token and the workspace for custom IDs.
 */
export function ClickUpSettings() {
  const qc = useQueryClient();
  const statusQ = useClickUpStatus();
  const cfgQ = useQuery({
    queryKey: qk.clickupConfig,
    queryFn: () => unwrap(api.integrations.clickup.getConfig())
  });
  const status = statusQ.data;
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshingTeams, setRefreshingTeams] = useState(false);

  async function refreshAll() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.clickupStatus }),
      qc.invalidateQueries({ queryKey: qk.clickupConfig }),
      qc.invalidateQueries({ queryKey: ['clickup', 'task'] })
    ]);
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const t = token.trim();
      // Tests the token and caches the workspaces before saving it.
      await unwrap(api.integrations.clickup.testAuth(t));
      await unwrap(api.integrations.clickup.setToken(t));
      await refreshAll();
      setEditing(false);
      setToken('');
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshTeams() {
    setRefreshingTeams(true);
    try {
      await unwrap(api.integrations.clickup.listTeams());
      await qc.invalidateQueries({ queryKey: qk.clickupConfig });
    } finally {
      setRefreshingTeams(false);
    }
  }

  let connection: React.ReactNode;
  if (statusQ.isLoading) {
    connection = (
      <div className="flex min-h-[52px] items-center gap-3 px-4 text-xs text-fg-muted">
        <Spinner size="xs" /> Checking the ClickUp connection…
      </div>
    );
  } else if (editing || status?.state === 'unconfigured') {
    connection = (
      <>
        <Row
          label="API token"
          htmlFor="cu-token"
          description={
            <>
              Personal token from{' '}
              <button
                className="text-accent hover:underline"
                onClick={() => api.shell.openExternal('https://app.clickup.com/settings/apps')}
              >
                ClickUp → Settings → Apps
              </button>
              . Encrypted with your macOS keychain.
            </>
          }
        >
          <input
            id="cu-token"
            autoFocus
            type="password"
            className="input h-7 w-72 font-mono text-2xs"
            placeholder="pk_…"
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
      </>
    );
  } else if (status?.state === 'error') {
    connection = (
      <Row
        label={
          <span className="flex items-center gap-2">
            <StatusDot tone="error" />
            ClickUp rejected the saved token
          </span>
        }
        description={status.message}
      >
        <button className="btn-primary" onClick={() => setEditing(true)}>
          Update token
        </button>
      </Row>
    );
  } else if (status?.state === 'ok') {
    const teams = cfgQ.data?.teams ?? [];
    connection = (
      <>
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
              await unwrap(api.integrations.clickup.setToken(null));
              await refreshAll();
            }}
          >
            Disconnect
          </button>
        </Row>
        <Row label="Workspace" description="Custom task IDs like REC-101 are looked up here.">
          <Select
            value={cfgQ.data?.teamId ?? ''}
            onValueChange={async (v) => {
              await unwrap(api.integrations.clickup.setTeam(v || null));
              await refreshAll();
            }}
            onOpenChange={(o) => o && teams.length === 0 && void refreshTeams()}
          >
            <SelectTrigger className="h-7 w-48 text-xs">
              <SelectValue placeholder={refreshingTeams ? 'Loading…' : 'Pick a workspace'} />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </>
    );
  }

  return (
    <Page title="ClickUp" description="Show a PR's task, its status and comments next to the code.">
      <Group title="Connection">{connection}</Group>
      <Group title="How PRs are linked">
        <Row
          label="Task ID in the branch name"
          description={
            <>
              <code className="font-mono text-fg-muted">feature/REC-101-login</code> links to REC-101;{' '}
              <code className="font-mono text-fg-muted">fix/app-8675309</code> to task 8675309. The PR header then shows
              the task, and its tab shows the description and comments.
            </>
          }
        />
      </Group>
    </Page>
  );
}
