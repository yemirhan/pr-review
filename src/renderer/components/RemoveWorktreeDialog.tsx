import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api, ApiError, unwrap } from '../lib/api';
import { useInvalidateWorkspaces } from '../lib/workspaces';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import type { PRWorkspaceStatus } from '@shared/types';

/**
 * Confirm removing a PR worktree. Uncommitted or unpushed work needs an
 * explicit second confirmation; unpushed commits always survive on the
 * branch (only the checkout folder goes away).
 */
export function RemoveWorktreeDialog({
  ws,
  open,
  onOpenChange,
  onRemoved
}: {
  ws: PRWorkspaceStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const invalidate = useInvalidateWorkspaces();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const risky = ws.dirty > 0 || (ws.unpushed ?? 0) > 0;

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await unwrap(api.workspaces.remove(ws.repoId, ws.prNumber, risky));
      await invalidate();
      onOpenChange(false);
      onRemoved?.();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Remove worktree for #{ws.prNumber}?</DialogTitle>
          <DialogDescription>
            Deletes <code className="font-mono text-fg">{ws.path}</code>.
            {ws.createdBranch && ws.unpushed === 0
              ? ` The local branch ${ws.branch} is deleted too; it's fully pushed.`
              : ` The branch ${ws.branch} is kept.`}
          </DialogDescription>
        </DialogHeader>
        {risky && (
          <div className="flex gap-2 rounded-md bg-attention-subtle px-3 py-2 text-sm text-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-attention" />
            <div>
              {ws.dirty > 0 && (
                <p>
                  {ws.dirty} uncommitted change{ws.dirty === 1 ? '' : 's'} will be lost.
                </p>
              )}
              {(ws.unpushed ?? 0) > 0 && (
                <p>
                  {ws.unpushed} unpushed commit{ws.unpushed === 1 ? '' : 's'} stay on branch{' '}
                  <code className="font-mono">{ws.branch}</code>, which is kept.
                </p>
              )}
            </div>
          </div>
        )}
        {err && <div className="text-sm text-danger whitespace-pre-wrap">{err}</div>}
        <DialogFooter>
          <button className="btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button className={risky ? 'btn-danger' : 'btn'} onClick={remove} disabled={busy}>
            {busy ? 'Removing…' : risky ? 'Remove anyway' : 'Remove worktree'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
