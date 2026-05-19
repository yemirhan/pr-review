import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ChevronDown,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
  Terminal
} from 'lucide-react';
import { api, qk, unwrap } from '../lib/api';
import { Button } from './ui/button';
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
  onCheckout
}: {
  prUrl: string;
  repoId: string;
  onCheckout: () => void;
}) {
  const editorsQ = useQuery({
    queryKey: qk.editors,
    queryFn: () => unwrap(api.editors.list()),
    staleTime: 5 * 60_000
  });
  const [opening, setOpening] = useState<string | null>(null);

  const editors = editorsQ.data ?? [];

  async function openIn(id: string) {
    setOpening(id);
    try {
      await unwrap(api.editors.open(id, repoId));
    } finally {
      setOpening(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <MoreHorizontal className="h-3.5 w-3.5" />
          Actions
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        <DropdownMenuItem onSelect={() => api.shell.openExternal(prUrl)}>
          <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          Open on GitHub
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCheckout}>
          <GitBranch className="h-3.5 w-3.5 opacity-70" />
          Checkout locally
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Open in editor</DropdownMenuLabel>
        {editorsQ.isLoading && (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        )}
        {!editorsQ.isLoading && editors.length === 0 && (
          <DropdownMenuItem disabled>No editors detected</DropdownMenuItem>
        )}
        {editors.map((e) => (
          <DropdownMenuItem
            key={e.id}
            onSelect={(ev) => {
              ev.preventDefault();
              openIn(e.id);
            }}
            disabled={opening === e.id}
          >
            <Terminal className="h-3.5 w-3.5 opacity-70" />
            <span className="flex-1">{e.label}</span>
            <span className="text-2xs text-fg-subtle">
              {opening === e.id ? '…' : e.cliPath ? 'CLI' : 'App'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
