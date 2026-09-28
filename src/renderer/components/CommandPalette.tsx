import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { GitPullRequest, Folder, Settings, SunMoon, Inbox, Search } from 'lucide-react';
import type { PRSummary, Repo } from '@shared/types';
import { api, qk, unwrap } from '../lib/api';
import { usePalette } from '../lib/palette';
import { visibleOpenPRs } from '../lib/shortcuts';
import { useUI } from '../store/ui';
import { cn } from '../lib/cn';

export { usePalette, openCommandPalette } from '../lib/palette';

const MAX_RESULTS = 50;

type Item =
  | { kind: 'pr'; key: string; repo: Repo; pr: PRSummary }
  | { kind: 'repo'; key: string; repo: Repo }
  | { kind: 'cmd'; key: string; label: string; icon: React.ReactNode; run: () => void };

const SECTION_LABEL: Record<Item['kind'], string> = {
  pr: 'Pull requests',
  repo: 'Repositories',
  cmd: 'Commands'
};

/** Every whitespace-separated token must appear somewhere in the haystack. */
function matches(tokens: string[], haystack: string): boolean {
  for (const t of tokens) if (!haystack.includes(t)) return false;
  return true;
}

/**
 * ⌘K palette: jump to any open PR across all added repos, switch repo, or
 * run a command. Mounted once in App; open via `usePalette` / `openCommandPalette()`.
 */
export function CommandPalette({ repos }: { repos: Repo[] }) {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
        <div className="pointer-events-none fixed inset-0 z-50 flex justify-center px-4 pt-[14vh]">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="pointer-events-auto flex max-h-[62vh] w-full max-w-xl flex-col overflow-hidden rounded-[10px] border border-border bg-canvas-overlay shadow-xl shadow-black/30 focus:outline-none data-[state=open]:animate-slide-up self-start"
          >
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            {open && <PaletteBody repos={repos} onClose={() => setOpen(false)} />}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteBody({ repos, onClose }: { repos: Repo[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const locallyClosed = useUI((s) => s.locallyClosed);

  // Same key + fetcher as PRList, so cached lists are reused and fresh ones are shared.
  const { prData, loadingPRs } = useQueries({
    queries: repos.map((r) => ({
      queryKey: qk.prs(r.id, 'open'),
      queryFn: () => unwrap(api.prs.list(r.id, 'open'))
    })),
    combine: (results) => ({
      prData: results.map((q) => q.data),
      loadingPRs: results.some((q) => q.isLoading)
    })
  });

  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of repos) m.set(r.name, (m.get(r.name) ?? 0) + 1);
    return m;
  }, [repos]);
  const repoLabel = (r: Repo) => ((nameCounts.get(r.name) ?? 0) > 1 ? `${r.owner}/${r.name}` : r.name);

  const items = useMemo<Item[]>(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ui = useUI.getState();

    const commands: Item[] = [
      {
        kind: 'cmd',
        key: 'cmd:inbox',
        label: 'Go to inbox',
        icon: <Inbox className="h-3.5 w-3.5" />,
        run: () => ui.selectPR(null)
      },
      {
        kind: 'cmd',
        key: 'cmd:settings',
        label: 'Open settings',
        icon: <Settings className="h-3.5 w-3.5" />,
        run: () => ui.setSettingsOpen(true)
      },
      {
        kind: 'cmd',
        key: 'cmd:theme',
        label: 'Toggle theme',
        icon: <SunMoon className="h-3.5 w-3.5" />,
        run: () => ui.toggleTheme()
      }
    ].filter((c) => matches(tokens, c.label.toLowerCase())) as Item[];

    const repoItems: Item[] = repos
      .filter((r) => matches(tokens, `${r.owner}/${r.name} ${r.label}`.toLowerCase()))
      .map((r) => ({ kind: 'repo', key: `repo:${r.id}`, repo: r }));

    // Current repo first, then the rest in sidebar order.
    const ordered = [...repos].sort(
      (a, b) => Number(b.id === selectedRepoId) - Number(a.id === selectedRepoId)
    );
    const prItems: Item[] = [];
    const exactNumber: Item[] = [];
    for (const r of ordered) {
      const data = prData[repos.indexOf(r)];
      if (!data) continue;
      for (const pr of visibleOpenPRs(data, r.id, locallyClosed)) {
        const hay = `#${pr.number} ${pr.title} ${pr.author.login} ${pr.headRefName}`.toLowerCase();
        if (!matches(tokens, hay)) continue;
        const item: Item = { kind: 'pr', key: `pr:${r.id}:${pr.number}`, repo: r, pr };
        const exact = tokens.length === 1 && tokens[0].replace(/^#/, '') === String(pr.number);
        (exact ? exactNumber : prItems).push(item);
      }
    }

    const prs = [...exactNumber, ...prItems];
    const budget = MAX_RESULTS - repoItems.length - commands.length;
    return [...prs.slice(0, Math.max(10, budget)), ...repoItems, ...commands].slice(0, MAX_RESULTS);
  }, [query, repos, selectedRepoId, locallyClosed, prData]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function run(item: Item | undefined) {
    if (!item) return;
    const ui = useUI.getState();
    onClose();
    if (item.kind === 'pr') {
      // selectRepo resets the PR, so it must come first.
      if (ui.selectedRepoId !== item.repo.id) ui.selectRepo(item.repo.id);
      ui.selectPR(item.pr.number);
    } else if (item.kind === 'repo') {
      ui.selectRepo(item.repo.id);
    } else {
      item.run();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[active]);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-muted px-3">
        <Search className="h-4 w-4 shrink-0 text-fg-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pull requests, repositories, commands…"
          className="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-subtle"
          role="combobox"
          aria-expanded
          aria-controls="command-palette-list"
          aria-activedescendant={items[active] ? `cp-${items[active].key}` : undefined}
        />
        {loadingPRs && <span className="text-2xs text-fg-subtle">Loading…</span>}
      </div>
      <div
        ref={listRef}
        id="command-palette-list"
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {items.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-fg-subtle">
            {loadingPRs ? 'Loading pull requests…' : 'No results'}
          </div>
        )}
        {items.map((item, i) => {
          const header = i === 0 || items[i - 1].kind !== item.kind;
          const selected = i === active;
          return (
            <div key={item.key}>
              {header && (
                <div className="px-2.5 pb-1 pt-2 text-2xs text-fg-subtle">
                  {SECTION_LABEL[item.kind]}
                </div>
              )}
              <div
                id={`cp-${item.key}`}
                data-idx={i}
                role="option"
                aria-selected={selected}
                onMouseMove={() => active !== i && setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(item)}
                className={cn(
                  'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm',
                  selected ? 'bg-canvas-subtle text-fg' : 'text-fg-muted'
                )}
              >
                {item.kind === 'pr' && (
                  <>
                    <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className="shrink-0 tabular-nums text-fg-subtle">#{item.pr.number}</span>
                    <span className="min-w-0 flex-1 truncate text-fg">{item.pr.title}</span>
                    <span className="shrink-0 truncate text-2xs text-fg-subtle">
                      {repoLabel(item.repo)}
                    </span>
                  </>
                )}
                {item.kind === 'repo' && (
                  <>
                    <Folder className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate text-fg">{repoLabel(item.repo)}</span>
                    <span className="shrink-0 text-2xs text-fg-subtle">{item.repo.owner}</span>
                  </>
                )}
                {item.kind === 'cmd' && (
                  <>
                    <span className="shrink-0 text-fg-subtle">{item.icon}</span>
                    <span className="flex-1 truncate text-fg">{item.label}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-border-muted px-3 py-1.5 text-2xs text-fg-subtle">
        <span className="inline-flex items-center gap-1">
          <span className="kbd">↑</span>
          <span className="kbd">↓</span> navigate
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="kbd">↵</span> open
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="kbd">esc</span> close
        </span>
      </div>
    </>
  );
}
