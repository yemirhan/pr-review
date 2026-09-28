import { useQuery } from '@tanstack/react-query';
import { GitPullRequest, Inbox, Search, Settings, X } from 'lucide-react';
import { api, qk, unwrap } from '../lib/api';
import { cn } from '../lib/cn';
import { useAISessionSummaries } from '../lib/aiSessions';
import { openCommandPalette } from '../lib/palette';
import { tabKey, useUI, type PRTab } from '../store/ui';
import { Spinner } from './ui/spinner';
import type { Repo } from '@shared/types';

const isMac = navigator.platform.toLowerCase().includes('mac');

/**
 * Title bar with browser-style tabs: a fixed "Pull requests" inbox tab, then
 * one tab per open PR. AI reviews keep running in background tabs; a tab
 * shows a spinner while its review runs and a dot when it finished unseen.
 */
export function TitleBar({ repos }: { repos: Repo[] }) {
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);
  const settingsOpen = useUI((s) => s.settingsOpen);
  const tabs = useUI((s) => s.tabs);
  const activeRepo = useUI((s) => s.selectedRepoId);
  const activePR = useUI((s) => s.selectedPRNumber);
  const selectPR = useUI((s) => s.selectPR);
  const inInbox = activePR == null && !settingsOpen;

  return (
    <div className="drag flex h-10 shrink-0 select-none items-center gap-2 border-b border-border-muted pl-3 pr-2">
      {/* spacer for the macOS traffic lights */}
      <div className="w-[68px] shrink-0" />
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => selectPR(null)}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors',
            inInbox ? 'bg-canvas-subtle text-fg' : 'text-fg-muted hover:bg-canvas-subtle/60 hover:text-fg'
          )}
          title="Pull requests (Esc)"
        >
          <Inbox className="h-3.5 w-3.5" />
          Pull requests
        </button>
        {tabs.length > 0 && <span className="divider-v mx-1 shrink-0" />}
        {tabs.map((t) => (
          <PRTabButton
            key={tabKey(t.repoId, t.prNumber)}
            tab={t}
            repo={repos.find((r) => r.id === t.repoId)}
            active={!settingsOpen && t.repoId === activeRepo && t.prNumber === activePR}
          />
        ))}
      </div>
      <button
        onClick={openCommandPalette}
        className="no-drag flex h-7 w-48 shrink-0 items-center gap-2 rounded-md border border-border-muted bg-canvas-inset px-2.5 text-left text-[13px] text-fg-subtle transition-colors hover:border-border hover:text-fg-muted"
        aria-label="Search pull requests"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">Search</span>
        <span className="kbd">{isMac ? '⌘K' : 'Ctrl K'}</span>
      </button>
      <button
        onClick={() => setSettingsOpen(!settingsOpen)}
        className={cn('btn-icon no-drag shrink-0', settingsOpen && 'bg-canvas-subtle text-fg')}
        aria-pressed={settingsOpen}
        title="Settings"
        aria-label="Open settings"
      >
        <Settings className="h-4 w-4" />
      </button>
    </div>
  );
}

function PRTabButton({ tab, repo, active }: { tab: PRTab; repo: Repo | undefined; active: boolean }) {
  const openPR = useUI((s) => s.openPR);
  const closeTab = useUI((s) => s.closeTab);
  const unseen = useUI((s) => !!s.unseen[tabKey(tab.repoId, tab.prNumber)]);
  const summary = useAISessionSummaries().get(tabKey(tab.repoId, tab.prNumber));
  const detailQ = useQuery({
    queryKey: qk.prDetail(tab.repoId, tab.prNumber),
    queryFn: () => unwrap(api.prs.get(tab.repoId, tab.prNumber)),
    staleTime: 5 * 60_000,
    enabled: !!repo
  });
  const title = detailQ.data?.title ?? '';
  const running = summary?.status === 'running';
  const aiLabel = running
    ? 'AI review running'
    : summary?.status === 'done'
      ? `AI review: ${summary.findings} finding${summary.findings === 1 ? '' : 's'}`
      : '';

  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={() => openPR(tab.repoId, tab.prNumber)}
      onAuxClick={(e) => {
        if (e.button === 1) closeTab(tab.repoId, tab.prNumber);
      }}
      title={[`${repo?.name ?? ''} #${tab.prNumber}`, title, aiLabel].filter(Boolean).join('\n')}
      className={cn(
        'group relative flex h-7 min-w-[120px] max-w-[220px] shrink-0 cursor-default items-center gap-1.5 rounded-md pl-2 pr-1 text-[13px] transition-colors',
        active ? 'bg-canvas-subtle text-fg' : 'text-fg-muted hover:bg-canvas-subtle/60 hover:text-fg'
      )}
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {running ? (
          <Spinner size="xs" />
        ) : (
          <GitPullRequest className={cn('h-3.5 w-3.5', active ? 'text-fg-muted' : 'text-fg-subtle')} />
        )}
        {unseen && !running && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-canvas" />
        )}
      </span>
      <span className="text-fg-subtle tabular-nums">#{tab.prNumber}</span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {summary?.status === 'done' && summary.findings > 0 && !running && (
        <span className="shrink-0 text-2xs tabular-nums text-accent">✦{summary.findings}</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.repoId, tab.prNumber);
        }}
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-canvas-overlay hover:text-fg',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        title="Close tab (⌘W)"
        aria-label="Close tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
