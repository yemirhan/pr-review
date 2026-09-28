import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ChevronDown,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  MoreHorizontal,
  Terminal,
  Trash2
} from 'lucide-react';
import { api, qk, unwrap } from '../lib/api';
import { useWorkspace } from '../lib/workspaces';
import { Button } from './ui/button';
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu';

export function PRActionsMenu({
  prUrl,
  repoId,
  prNumber,
  onCheckout
}: {
  prUrl: string;
  repoId: string;
  prNumber: number;
  onCheckout: () => void;
}) {
  const editorsQ = useQuery({
    queryKey: qk.editors,
    queryFn: () => unwrap(api.editors.list()),
    staleTime: 5 * 60_000
  });
  const ws = useWorkspace(repoId, prNumber).data ?? null;
  const [opening, setOpening] = useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const editors = editorsQ.data ?? [];

  async function openIn(id: string) {
    setOpening(id);
    try {
      await unwrap(api.editors.open(id, repoId, undefined, prNumber));
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            <MoreHorizontal className="h-3.5 w-3.5" />
            Actions
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <DropdownMenuItem onSelect={() => api.shell.openExternal(prUrl)}>
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            Open on GitHub
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          {ws ? (
            <>
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <GitBranch className="h-3 w-3" />
                <span className="truncate font-mono">{ws.branch}</span>
                {(ws.dirty > 0 || (ws.unpushed ?? 0) > 0) && (
                  <span className="ml-auto text-attention">
                    {ws.dirty > 0 ? `${ws.dirty} changed` : ''}
                    {ws.dirty > 0 && (ws.unpushed ?? 0) > 0 ? ' · ' : ''}
                    {(ws.unpushed ?? 0) > 0 ? `${ws.unpushed} unpushed` : ''}
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void api.workspaces.reveal(repoId, prNumber)}>
                <FolderOpen className="h-3.5 w-3.5 opacity-70" />
                Reveal worktree
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(ws.path)}>
                <Copy className="h-3.5 w-3.5 opacity-70" />
                Copy worktree path
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRemoveOpen(true)} className="text-danger">
                <Trash2 className="h-3.5 w-3.5 opacity-70" />
                Remove worktree…
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={onCheckout}>
              <GitBranch className="h-3.5 w-3.5 opacity-70" />
              Check out in worktree
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>{ws ? 'Open worktree in' : 'Open repo in'}</DropdownMenuLabel>
          {editorsQ.isLoading && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
          {!editorsQ.isLoading && editors.length === 0 && (
            <DropdownMenuItem disabled>No editors detected</DropdownMenuItem>
          )}
          {editors.map((e) => (
            <DropdownMenuItem
              key={e.id}
              onSelect={(ev) => {
                ev.preventDefault();
                void openIn(e.id);
              }}
              disabled={opening === e.id}
            >
              <Terminal className="h-3.5 w-3.5 opacity-70" />
              <span className="flex-1">{e.label}</span>
              <span className="text-2xs text-fg-subtle">{opening === e.id ? '…' : e.cliPath ? 'CLI' : 'App'}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {ws && <RemoveWorktreeDialog ws={ws} open={removeOpen} onOpenChange={setRemoveOpen} />}
    </>
  );
}
