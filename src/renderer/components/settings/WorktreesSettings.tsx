import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, GitBranch, Trash2 } from 'lucide-react';
import { api, ApiError, qk, unwrap } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useInvalidateWorkspaces } from '../../lib/workspaces';
import { useUI } from '../../store/ui';
import { RemoveWorktreeDialog } from '../RemoveWorktreeDialog';
import { Spinner } from '../ui/spinner';
import { Group, Page, Row } from './primitives';
import type { PRWorkspaceStatus, Repo } from '@shared/types';

/** Settings → Worktrees: every PR checkout, plus the AI review cache, with cleanup. */
export function WorktreesSettings() {
  const qc = useQueryClient();
  const invalidate = useInvalidateWorkspaces();
  const reposQ = useQuery({ queryKey: qk.repos, queryFn: () => unwrap(api.repos.list()) });
  const listQ = useQuery({ queryKey: qk.workspaces, queryFn: () => unwrap(api.workspaces.list()) });
  const cacheQ = useQuery({ queryKey: qk.reviewCache, queryFn: () => unwrap(api.workspaces.reviewCacheInfo()) });
  const [removing, setRemoving] = useState<PRWorkspaceStatus | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [clearing, setClearing] = useState(false);

  const list = listQ.data ?? [];
  const repos = reposQ.data ?? [];
  // Safe to remove without asking: PR is done and nothing local would be lost.
  const done = list.filter(
    (w) => (w.prState === 'MERGED' || w.prState === 'CLOSED' || !w.exists) && w.dirty === 0 && (w.unpushed ?? 0) === 0
  );

  async function removeDone() {
    setBulkMsg(null);
    setBulkBusy(true);
    let failed = 0;
    for (const w of done) {
      try {
        await unwrap(api.workspaces.remove(w.repoId, w.prNumber, false));
      } catch {
        failed++;
      }
    }
    if (failed) setBulkMsg(`${failed} could not be removed.`);
    setBulkBusy(false);
    await invalidate();
  }

  async function clearCache() {
    setClearing(true);
    try {
      await unwrap(api.workspaces.clearReviewCache());
      await qc.invalidateQueries({ queryKey: qk.reviewCache });
    } finally {
      setClearing(false);
    }
  }

  const byRepo = new Map<string, PRWorkspaceStatus[]>();
  for (const w of list) byRepo.set(w.repoId, [...(byRepo.get(w.repoId) ?? []), w]);

  return (
    <Page
      title="Worktrees"
      description={
        <>
          Each checked-out PR gets its own git worktree next to the repo (
          <code className="font-mono">&lt;repo&gt;.worktrees/pr-N</code>), so several PRs can be checked out at once.
          Worktrees are never removed automatically.
        </>
      }
    >
      <Group
        title="PR worktrees"
        action={
          list.length > 0 && (
            <button
              className="btn-ghost h-7 text-xs"
              disabled={done.length === 0 || bulkBusy}
              onClick={() => void removeDone()}
              title="Skips worktrees with uncommitted or unpushed work"
            >
              {bulkBusy ? <Spinner size="xs" /> : <Trash2 className="h-3.5 w-3.5" />}
              Remove merged &amp; closed{done.length > 0 ? ` (${done.length})` : ''}
            </button>
          )
        }
        description={bulkMsg ? <span className="text-danger">{bulkMsg}</span> : undefined}
      >
        {listQ.isLoading ? (
          <div className="px-4 py-3">
            <Spinner size="xs" />
          </div>
        ) : listQ.error ? (
          <div className="px-4 py-3 text-2xs text-danger">{(listQ.error as ApiError).message}</div>
        ) : list.length === 0 ? (
          <Row
            label="No PR worktrees"
            description="Use Actions → Check out in worktree on a PR to create one."
          />
        ) : (
          [...byRepo.entries()].map(([repoId, items]) => (
            <div key={repoId}>
              <div className="bg-canvas-subtle/40 px-4 py-1.5 text-2xs text-fg-subtle">
                {repos.find((r) => r.id === repoId)?.label ?? repoId}
              </div>
              <div className="divide-y divide-border-muted">
                {items
                  .sort((a, b) => b.prNumber - a.prNumber)
                  .map((w) => (
                    <WorktreeRow
                      key={w.prNumber}
                      ws={w}
                      repo={repos.find((r) => r.id === w.repoId)}
                      onRemove={() => setRemoving(w)}
                    />
                  ))}
              </div>
            </div>
          ))
        )}
      </Group>

      <Group title="AI review cache">
        <Row
          label={
            cacheQ.data
              ? `${cacheQ.data.count} checkout${cacheQ.data.count === 1 ? '' : 's'}${
                  cacheQ.data.inUse > 0 ? ` · ${cacheQ.data.inUse} in use` : ''
                }`
              : 'Checkouts'
          }
          description="Read-only checkouts the AI reviewer uses when a PR has no clean worktree. The 10 most recent are kept."
        >
          <button
            className="btn"
            disabled={clearing || !cacheQ.data || cacheQ.data.count - cacheQ.data.inUse === 0}
            onClick={() => void clearCache()}
          >
            {clearing ? 'Clearing…' : 'Clear'}
          </button>
        </Row>
      </Group>

      {removing && (
        <RemoveWorktreeDialog
          ws={removing}
          open
          onOpenChange={(o) => {
            if (!o) setRemoving(null);
          }}
        />
      )}
    </Page>
  );
}

function WorktreeRow({ ws, repo, onRemove }: { ws: PRWorkspaceStatus; repo: Repo | undefined; onRemove: () => void }) {
  const openPR = useUI((s) => s.openPR);
  const stateLabel =
    ws.prState === 'MERGED' ? 'merged' : ws.prState === 'CLOSED' ? 'closed' : ws.prState === 'OPEN' ? 'open' : null;
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <button
          className="block max-w-full truncate text-left text-[13px] text-fg hover:underline"
          onClick={() => repo && openPR(repo.id, ws.prNumber)}
          title="Open PR"
        >
          <span className="tabular-nums text-fg-subtle">#{ws.prNumber}</span> {ws.prTitle ?? ''}
        </button>
        <div className="mt-0.5 flex items-center gap-2 text-2xs text-fg-subtle">
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono" title={ws.path}>
            {ws.branch}
          </span>
          {stateLabel && (
            <span className={cn(ws.prState === 'OPEN' ? 'text-fg-muted' : 'text-fg-subtle')}>· {stateLabel}</span>
          )}
          {!ws.exists && <span className="text-attention">· folder missing</span>}
          {ws.dirty > 0 && <span className="text-attention">· {ws.dirty} uncommitted</span>}
          {(ws.unpushed ?? 0) > 0 && <span className="text-attention">· {ws.unpushed} unpushed</span>}
        </div>
      </div>
      {ws.exists && (
        <button
          className="btn-icon h-7 w-7"
          title="Reveal in Finder"
          onClick={() => void api.workspaces.reveal(ws.repoId, ws.prNumber)}
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      )}
      <button className="btn-icon h-7 w-7" title="Remove worktree" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
