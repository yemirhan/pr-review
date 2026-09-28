import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, GitBranch, RotateCw, Sparkles } from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { useUI } from '../store/ui';
import { relativeTime } from '../lib/format';
import { getMergeStatus, MergeStatusPopover } from './MergeStatus';
import { ChecksPill } from './ChecksPill';
import { DiffViewer, type DiffHighlight } from './DiffViewer';
import { ReviewButton } from './ReviewBar';
import { MergeModal } from './MergeModal';
import { CheckoutModal } from './CheckoutModal';
import { ConflictsView } from './ConflictsView';
import { ChecksView } from './ChecksView';
import { PRActionsMenu } from './PRActionsMenu';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { AIPanel, type JumpTarget } from './ai/AIPanel';
import { Spinner } from './ui/spinner';
import { useAISession, visibleFindings } from '../lib/aiSessions';
import { useWorkspace } from '../lib/workspaces';
import { RemoveWorktreeDialog } from './RemoveWorktreeDialog';
import { FileTree } from './FileTree';
import { FileTreeAside } from './FileTreeAside';
import { DiffSearchBar, type DiffSearchBarHandle } from './DiffSearchBar';
import { useDiffSearch, useScrollToMatch } from '../lib/diffSearch';
import { ClickUpTaskTab } from './integrations/ClickUpTaskTab';
import { ClickUpCommentsTab } from './integrations/ClickUpCommentsTab';
import { BuildsTab } from './integrations/BuildsTab';
import { useBuildSummary, type BuildSummary } from '../lib/builds';
import type { PRIssueComment, PRSummary, Repo } from '@shared/types';

type Tab =
  | 'files'
  | 'conversation'
  | 'commits'
  | 'checks'
  | 'conflicts'
  | 'clickup-task'
  | 'clickup-comments'
  | 'builds';

/** Per-PR view state, so switching tabs returns to the same place. */
const viewState = new Map<string, { tab: Tab; scrollTop: number }>();

export function PRDetail({ repo, prNumber }: { repo: Repo | null; prNumber: number | null }) {
  const qc = useQueryClient();
  const markLocallyClosed = useUI((s) => s.markLocallyClosed);
  const viewKey = repo && prNumber != null ? `${repo.id}:${prNumber}` : '';
  const [tab, setTab] = useState<Tab>(() => viewState.get(viewKey)?.tab ?? 'files');
  useEffect(() => {
    if (!viewKey) return;
    viewState.set(viewKey, { scrollTop: viewState.get(viewKey)?.scrollTop ?? 0, tab });
  }, [viewKey, tab]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSuccessNonce, setCheckoutSuccessNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<DiffHighlight | null>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<DiffSearchBarHandle>(null);
  // When we first saw `mergeable === null` for the current PR; drives the
  // poll backoff below.
  const mergeablePollStart = useRef<number | null>(null);

  useEffect(() => {
    mergeablePollStart.current = null;
  }, [repo?.id, prNumber]);

  const detailQ = useQuery({
    queryKey: repo && prNumber != null ? qk.prDetail(repo.id, prNumber) : ['no-detail'],
    queryFn: () => unwrap(api.prs.get(repo!.id, prNumber!)),
    enabled: !!repo && prNumber != null,
    // GitHub computes mergeability lazily; poll while it's unknown so the
    // Merge button enables itself once the state resolves. Back off over
    // time and stop after a few minutes — some PRs stay UNKNOWN for a long
    // while and a 5s poll forever is a great way to get rate limited.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || d.state !== 'OPEN' || d.mergeable !== null) {
        mergeablePollStart.current = null;
        return false;
      }
      const now = Date.now();
      if (mergeablePollStart.current == null) mergeablePollStart.current = now;
      const elapsed = now - mergeablePollStart.current;
      if (elapsed < 30_000) return 5_000;
      if (elapsed < 2 * 60_000) return 15_000;
      if (elapsed < 5 * 60_000) return 30_000;
      return false;
    }
  });

  const filesQ = useQuery({
    queryKey: repo && prNumber != null ? qk.prFiles(repo.id, prNumber) : ['no-files'],
    queryFn: () => unwrap(api.prs.files(repo!.id, prNumber!)),
    enabled: !!repo && prNumber != null && tab === 'files'
  });

  const commentsQ = useQuery({
    queryKey: repo && prNumber != null ? qk.prComments(repo.id, prNumber) : ['no-comments'],
    queryFn: () => unwrap(api.prs.comments(repo!.id, prNumber!)),
    enabled: !!repo && prNumber != null
  });

  // Top-level conversation comments are only needed on the Conversation
  // tab, so don't spend a request on them until it's opened.
  const issueCommentsQ = useQuery({
    queryKey:
      repo && prNumber != null ? qk.prIssueComments(repo.id, prNumber) : ['no-issue-comments'],
    queryFn: () => unwrap(api.prs.issueComments(repo!.id, prNumber!)),
    enabled: !!repo && prNumber != null && tab === 'conversation'
  });

  const branchForClickUp = detailQ.data?.headRefName ?? null;
  const clickupQ = useQuery({
    queryKey:
      repo && branchForClickUp
        ? qk.clickupTaskByBranch(repo.id, branchForClickUp)
        : ['no-clickup'],
    queryFn: () => unwrap(api.integrations.clickup.taskByBranch(repo!.id, branchForClickUp!)),
    enabled: !!repo && !!branchForClickUp,
    retry: false,
    staleTime: 30_000
  });
  const clickupResult = clickupQ.data ?? null;
  const clickupLinked = clickupResult?.linked ?? null;

  const builds = useBuildSummary(
    repo?.id ?? '',
    detailQ.data?.headRefName ?? '',
    prNumber ?? 0,
    detailQ.data?.headRefOid ?? ''
  );

  const search = useDiffSearch(filesQ.data ?? []);
  const activeMatch = search.matches[search.current - 1];
  useScrollToMatch(activeMatch, diffScrollRef);

  // Clear / reset search when PR changes.
  useEffect(() => {
    setSearchOpen(false);
    search.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.id, prNumber]);

  // Intercept Cmd/Ctrl+F at the document level whenever a PR is open.
  useEffect(() => {
    if (!repo || prNumber == null) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (tab !== 'files') setTab('files');
        setSearchOpen(true);
        // Defer focus so the input is mounted.
        requestAnimationFrame(() => searchBarRef.current?.focus());
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [repo, prNumber, tab]);

  // Track which file is currently scrolled into the diff viewport. We pick
  // the section whose top is closest to (but not past) the container's top
  // edge — i.e. the file the user is reading right now.
  useEffect(() => {
    const container = diffScrollRef.current;
    if (!container) return;
    let frame = 0;
    function update() {
      frame = 0;
      const el = diffScrollRef.current;
      if (!el) return;
      const sections = el.querySelectorAll<HTMLElement>('[data-file-path]');
      if (sections.length === 0) {
        setVisibleFilePath(null);
        return;
      }
      const containerTop = el.getBoundingClientRect().top;
      let best: { path: string; rel: number } | null = null;
      sections.forEach((s) => {
        const rel = s.getBoundingClientRect().top - containerTop;
        // Pick the section whose top is at or just above the viewport top.
        if (rel <= 8) {
          if (!best || rel > best.rel) {
            best = { path: s.dataset.filePath ?? '', rel };
          }
        }
      });
      if (best) {
        setVisibleFilePath((cur) => (cur === best!.path ? cur : best!.path));
      } else {
        // None above yet — use the first one.
        const first = sections[0].dataset.filePath ?? null;
        setVisibleFilePath((cur) => (cur === first ? cur : first));
      }
    }
    function onScroll() {
      const v = viewState.get(viewKey);
      if (v && container) v.scrollTop = container.scrollTop;
      if (frame) return;
      frame = requestAnimationFrame(update);
    }
    container.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [filesQ.data, tab, viewKey]);

  // Restore the diff scroll position when coming back to this tab. The diff
  // renders progressively, so wait until it's tall enough.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || tab !== 'files' || !filesQ.data) return;
    const target = viewState.get(viewKey)?.scrollTop ?? 0;
    restored.current = true;
    if (target <= 0) return;
    let tries = 0;
    const tick = () => {
      const el = diffScrollRef.current;
      if (!el) return;
      if (el.scrollHeight - el.clientHeight >= target || tries++ > 40) {
        el.scrollTop = target;
        return;
      }
      setTimeout(tick, 50);
    };
    requestAnimationFrame(tick);
  }, [tab, filesQ.data, viewKey]);

  const onSelectFileFromTree = useCallback((path: string) => {
    // Scroll the file's header into view at the top of the diff container.
    const container = diffScrollRef.current;
    if (!container) return;
    const sel = `[data-file-header="${path.replace(/(["\\])/g, '\\$1')}"]`;
    const target = container.querySelector(sel) as HTMLElement | null;
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  // Jump to an AI finding: switch to Files, expand + spotlight the file, then
  // scroll to the finding card under its line (or the file header).
  const jumpToLine = useCallback((target: JumpTarget) => {
    setTab('files');
    if (target.line != null) {
      setHighlight({
        path: target.path,
        line: target.line,
        startLine: target.startLine,
        side: target.side,
        nonce: Date.now()
      });
    } else {
      setHighlight(null);
    }
    let attempts = 0;
    const tryScroll = () => {
      const container = diffScrollRef.current;
      const esc = (v: string) => v.replace(/(["\\])/g, '\\$1');
      const card = target.findingId
        ? (container?.querySelector(`[data-finding-id="${esc(target.findingId)}"]`) as HTMLElement | null)
        : null;
      if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.animate?.([{ boxShadow: '0 0 0 2px rgb(var(--c-accent) / 0.6)' }, { boxShadow: 'none' }], {
          duration: 1200
        });
        return;
      }
      const header = container?.querySelector(`[data-file-header="${esc(target.path)}"]`) as HTMLElement | null;
      // Give the file a moment to render its annotations before settling on the header.
      if (header && (attempts > 8 || !target.findingId)) {
        header.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (attempts++ < 25) setTimeout(tryScroll, 60);
    };
    requestAnimationFrame(tryScroll);
  }, []);

  // Drop the spotlight when the PR changes.
  useEffect(() => {
    setHighlight(null);
  }, [repo?.id, prNumber]);

  const workspace = useWorkspace(repo?.id, prNumber).data ?? null;
  const [removeWsOpen, setRemoveWsOpen] = useState(false);

  // AI review: findings shown in the diff only when the review matches the
  // current head (older line numbers may point at the wrong code).
  const sessionQ = useAISession(repo?.id, prNumber);
  const session = sessionQ.data ?? null;
  const headOid = detailQ.data?.headRefOid;
  const inlineFindings = useMemo(
    () => (session && headOid && session.headOid === headOid ? visibleFindings(session) : []),
    [session, headOid]
  );
  const findingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of inlineFindings) m.set(f.path, (m.get(f.path) ?? 0) + 1);
    return m;
  }, [inlineFindings]);

  // Opt-in auto-review: start once per PR head when there's no current review.
  const cfgQ = useQuery({ queryKey: qk.aiConfig, queryFn: () => unwrap(api.ai.getConfig()) });
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!cfgQ.data?.autoReview || !repo || prNumber == null || !headOid || sessionQ.isLoading) return;
    if (detailQ.data?.state !== 'OPEN') return;
    const key = `${repo.id}:${prNumber}:${headOid}`;
    if (autoStarted.current === key) return;
    if (session && (session.status === 'running' || session.headOid === headOid)) return;
    autoStarted.current = key;
    void unwrap(api.ai.startReview(repo.id, prNumber)).then((s) =>
      qc.setQueryData(qk.aiSession(repo.id, prNumber), s)
    );
  }, [cfgQ.data?.autoReview, repo, prNumber, headOid, session, sessionQ.isLoading, detailQ.data?.state, qc]);

  if (!repo || prNumber == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-subtle">
        Select a PR
      </div>
    );
  }

  if (detailQ.isLoading) {
    return <PRDetailSkeleton />;
  }
  if (detailQ.error) {
    const ae = detailQ.error as ApiError;
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-danger bg-danger-subtle border border-danger-emphasis/40 rounded-md px-4 py-3 max-w-md">
          {ae.message}
        </div>
      </div>
    );
  }
  const pr = detailQ.data!;
  const mergeStatus = getMergeStatus(pr);

  /**
   * After a merge: update the UI immediately instead of waiting for GitHub.
   * The list endpoint lags a few seconds behind a merge, so a plain refetch
   * often brings the PR back as "open" until the next refresh.
   */
  function onMergedOptimistic() {
    if (!repo || prNumber == null) return;
    const repoId = repo.id;
    const num = prNumber;
    markLocallyClosed(repoId, num);
    qc.setQueryData<PRSummary[]>(qk.prs(repoId, 'open'), (old) =>
      old ? old.filter((p) => p.number !== num) : old
    );
    qc.setQueryData<Record<string, number>>(qk.openCounts, (old) =>
      old && old[repoId] != null ? { ...old, [repoId]: Math.max(0, old[repoId] - 1) } : old
    );
    qc.setQueryData(qk.prDetail(repoId, num), (old: typeof detailQ.data) =>
      old ? { ...old, state: 'MERGED' as const, mergedAt: new Date().toISOString() } : old
    );
    // Reconcile with GitHub once it has had a moment to catch up.
    setTimeout(() => void invalidatePR(), 2500);
  }

  async function invalidatePR() {
    if (!repo || prNumber == null) return;
    // Bust the main-process cache first so the refetches below actually
    // reach GitHub instead of being served the same cached payload.
    try {
      await unwrap(api.prs.refresh(repo.id, prNumber));
    } catch {
      /* best effort */
    }
    qc.invalidateQueries({ queryKey: qk.prDetail(repo.id, prNumber) });
    qc.invalidateQueries({ queryKey: qk.prs(repo.id) });
    qc.invalidateQueries({ queryKey: qk.openCounts });
    qc.invalidateQueries({ queryKey: qk.prComments(repo.id, prNumber) });
    qc.invalidateQueries({ queryKey: qk.prIssueComments(repo.id, prNumber) });
    qc.invalidateQueries({ queryKey: qk.prChecks(repo.id, prNumber) });
    if (branchForClickUp) {
      qc.invalidateQueries({ queryKey: qk.clickupTaskByBranch(repo.id, branchForClickUp) });
    }
  }

  const back = () => useUI.getState().selectPR(null);
  const integrationTabs: { id: Tab; label: string }[] = [
    ...(clickupLinked ? [{ id: 'clickup-task' as Tab, label: 'ClickUp' }] : [])
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-canvas">
      {/* Header */}
      <div className="px-5 pt-2.5 border-b border-border-muted">
        <div className="flex items-center gap-1 text-xs text-fg-subtle h-6">
          <button
            onClick={back}
            className="inline-flex items-center gap-0.5 -ml-1 px-1 h-6 rounded hover:text-fg hover:bg-canvas-subtle"
            title="Back to pull requests (Esc)"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {repo.name}
          </button>
          <span className="text-fg-subtle/60">/</span>
          <a
            href={pr.url}
            onClick={(e) => {
              e.preventDefault();
              api.shell.openExternal(pr.url);
            }}
            className="px-1 hover:text-fg hover:underline"
            title="Open on GitHub"
          >
            #{pr.number}
          </a>
        </div>
        <div className="flex items-start gap-4 mt-0.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <h1 className="text-lg font-semibold leading-snug text-fg line-clamp-2" title={pr.title}>
                {pr.title}
              </h1>
              {clickupLinked && (
                <ClickUpTitleButton
                  repoId={repo.id}
                  prNumber={pr.number}
                  currentTitle={pr.title}
                  taskId={clickupLinked.task.customId || clickupLinked.task.id}
                  taskName={clickupLinked.task.name}
                  onRenamed={invalidatePR}
                />
              )}
            </div>
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1 text-xs text-fg-muted">
              {pr.isDraft && <span className="chip">Draft</span>}
              <span>@{pr.author.login}</span>
              <span className="text-fg-subtle">·</span>
              <span>opened {relativeTime(pr.createdAt)}</span>
              <span className="text-fg-subtle">·</span>
              <span className="font-mono text-2xs text-fg-subtle truncate max-w-[420px]" title={`${pr.headRefName} → ${pr.baseRefName}`}>
                {pr.headRefName} → {pr.baseRefName}
              </span>
              <span className="text-fg-subtle">·</span>
              <span className="tabular-nums">
                <span className="text-success/90">+{pr.additions}</span>{' '}
                <span className="text-danger/90">−{pr.deletions}</span>
              </span>
              <ChecksPill checks={pr.checks} />
              <BuildsPill summary={builds} onClick={() => setTab('builds')} />
              {workspace && (
                <button
                  className="inline-flex items-center gap-1 text-2xs text-fg-muted hover:text-fg"
                  title={`Checked out in a worktree: ${workspace.path}\nClick to reveal`}
                  onClick={() => void api.workspaces.reveal(repo.id, pr.number)}
                >
                  <GitBranch className="h-3 w-3" />
                  worktree
                  {workspace.dirty > 0 && <span className="text-attention">· {workspace.dirty} changed</span>}
                </button>
              )}
              {clickupLinked && (
                <button
                  className="inline-flex items-center gap-1.5 text-2xs hover:text-fg"
                  onClick={() => api.shell.openExternal(clickupLinked.task.url)}
                  title={`${clickupLinked.task.name} — open in ClickUp`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: clickupLinked.task.status.color }} />
                  <span className="font-mono">{clickupLinked.task.customId || clickupLinked.task.id}</span>
                  <span className="text-fg-subtle">{clickupLinked.task.status.status}</span>
                </button>
              )}
              {!clickupLinked && clickupResult && clickupResult.reason === 'not-found' && (
                <span
                  className="text-2xs text-fg-subtle"
                  title={`Task ${clickupResult.parsedTaskId} not found in ClickUp (or token lacks access).`}
                >
                  ClickUp {clickupResult.parsedTaskId} not found
                </span>
              )}
              {clickupQ.error && (
                <span className="text-2xs text-danger" title={(clickupQ.error as ApiError).message}>
                  ClickUp error
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={invalidatePR}
              disabled={detailQ.isFetching}
              title="Refresh PR"
            >
              <RotateCw className={cn('h-4 w-4', detailQ.isFetching && 'animate-spin')} />
            </Button>
            <AIToggle repoId={repo.id} prNumber={pr.number} />
            <PRActionsMenu
              prUrl={pr.url}
              repoId={repo.id}
              prNumber={pr.number}
              onCheckout={() => setCheckoutOpen(true)}
            />
            <span className="divider-v mx-1" />
            {pr.state === 'OPEN' && (
              <ReviewButton repo={repo} prNumber={pr.number} headOid={pr.headRefOid} onSubmitted={invalidatePR} />
            )}
            {pr.state === 'OPEN' ? (
              <MergeStatusPopover status={mergeStatus} onShowConflicts={() => setTab('conflicts')}>
                <Button
                  variant="primary"
                  disabled={!mergeStatus.canMerge}
                  onClick={() => setMergeOpen(true)}
                  title={mergeStatus.label ? undefined : 'Merge this PR'}
                >
                  Merge
                </Button>
              </MergeStatusPopover>
            ) : (
              <span className="chip">{pr.state === 'MERGED' ? 'Merged' : 'Closed'}</span>
            )}
          </div>
        </div>
        {/* Tabs */}
        <div role="tablist" className="flex items-center gap-5 mt-2">
          <Tab id="files" active={tab} onClick={setTab} label="Files" count={pr.changedFiles} />
          <Tab
            id="conversation"
            active={tab}
            onClick={setTab}
            label="Conversation"
            count={
              (commentsQ.data?.length ?? 0) + countVisibleReviews(pr.reviews) + (issueCommentsQ.data?.length ?? 0)
            }
          />
          <Tab id="commits" active={tab} onClick={setTab} label="Commits" count={pr.commits.length} />
          <Tab
            id="checks"
            active={tab}
            onClick={setTab}
            label="Checks"
            count={pr.checks.total > 0 ? pr.checks.total : undefined}
            tone={pr.checks.state === 'FAILURE' ? 'danger' : pr.checks.state === 'PENDING' ? 'attention' : undefined}
          />
          {builds.available && (
            <Tab
              id="builds"
              active={tab}
              onClick={setTab}
              label="Builds"
              count={builds.total > 0 ? builds.total : undefined}
              tone={builds.failed > 0 ? 'danger' : builds.running > 0 ? 'attention' : undefined}
            />
          )}
          {pr.mergeable === false && (
            <Tab id="conflicts" active={tab} onClick={setTab} label="Conflicts" tone="danger" />
          )}
          {integrationTabs.length > 0 && (
            <div className="ml-auto flex items-center gap-5">
              {integrationTabs.map((t) => (
                <Tab key={t.id} id={t.id} active={tab} onClick={setTab} label={t.label} />
              ))}
            </div>
          )}
        </div>
      </div>

      {workspace && pr.state !== 'OPEN' && (
        <div className="flex items-center gap-3 border-b border-border-muted bg-canvas-subtle px-5 py-2 text-sm">
          <GitBranch className="h-4 w-4 shrink-0 text-fg-subtle" />
          <span className="flex-1 text-fg-muted">
            This PR is {pr.state === 'MERGED' ? 'merged' : 'closed'}; its worktree at{' '}
            <code className="font-mono text-fg">{workspace.path}</code> is probably no longer needed.
          </span>
          <button className="btn h-7" onClick={() => setRemoveWsOpen(true)}>
            Remove worktree
          </button>
        </div>
      )}
      {workspace && (
        <RemoveWorktreeDialog ws={workspace} open={removeWsOpen} onOpenChange={setRemoveWsOpen} />
      )}

      {/* Content + AI panel */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {tab === 'files' && (
              <div className="flex-1 min-h-0 flex">
                <FileTreeAside>
                  <FileTree
                    files={filesQ.data ?? []}
                    repoId={repo.id}
                    prNumber={pr.number}
                    headOid={pr.headRefOid}
                    filesWithMatches={search.filesWithMatches}
                    activeFilePath={activeMatch?.filePath}
                    viewingFilePath={visibleFilePath ?? undefined}
                    onSelectFile={onSelectFileFromTree}
                    findingCounts={findingCounts}
                  />
                </FileTreeAside>
                <div className="flex-1 min-w-0 flex flex-col">
                  {searchOpen && (
                    <DiffSearchBar
                      ref={searchBarRef}
                      query={search.query}
                      onQueryChange={search.setQuery}
                      current={search.current}
                      total={search.total}
                      onNext={search.next}
                      onPrev={search.prev}
                      onClose={() => {
                        setSearchOpen(false);
                        search.clear();
                      }}
                    />
                  )}
                  <DiffViewer
                    ref={diffScrollRef}
                    loading={filesQ.isLoading}
                    error={filesQ.error as ApiError | null}
                    files={filesQ.data ?? []}
                    threads={commentsQ.data ?? []}
                    repoId={repo.id}
                    prNumber={pr.number}
                    headOid={pr.headRefOid}
                    activeMatch={activeMatch}
                    filesWithMatches={search.filesWithMatches}
                    highlight={highlight}
                    findings={inlineFindings}
                  />
                </div>
              </div>
            )}
            {tab === 'conversation' && (
              <Conversation
                pr={pr}
                comments={commentsQ.data ?? []}
                issueComments={issueCommentsQ.data ?? []}
                issueCommentsLoading={issueCommentsQ.isLoading}
                issueCommentsError={(issueCommentsQ.error as ApiError | null)?.message ?? null}
              />
            )}
            {tab === 'commits' && <Commits commits={pr.commits} />}
            {tab === 'checks' && <ChecksView repo={repo} prNumber={pr.number} />}
            {tab === 'conflicts' && (
              <ConflictsView repo={repo} prNumber={pr.number} baseRefName={pr.baseRefName} />
            )}
            {tab === 'clickup-task' && clickupLinked && (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <ClickUpTaskTab task={clickupLinked.task} />
                <div className="border-t border-border-muted">
                  <ClickUpCommentsTab taskId={clickupLinked.task.id} />
                </div>
              </div>
            )}
            {tab === 'builds' && (
              <BuildsTab repo={repo} branch={pr.headRefName} prNumber={pr.number} headSha={pr.headRefOid} />
            )}
          </div>
        </div>

        <AIPanel
          repoId={repo.id}
          prNumber={pr.number}
          headOid={pr.headRefOid}
          onRequestCheckout={() => setCheckoutOpen(true)}
          onJumpTo={jumpToLine}
          checkoutSuccessNonce={checkoutSuccessNonce}
        />
      </div>

      {mergeOpen && (
        <MergeModal
          pr={pr}
          repo={repo}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            onMergedOptimistic();
          }}
        />
      )}
      {checkoutOpen && (
        <CheckoutModal
          repo={repo}
          prNumber={prNumber}
          onClose={() => setCheckoutOpen(false)}
          onSuccess={() => {
            setCheckoutSuccessNonce((n) => n + 1);
            invalidatePR();
          }}
        />
      )}
    </div>
  );
}

function ClickUpTitleButton({
  repoId,
  prNumber,
  currentTitle,
  taskId,
  taskName,
  onRenamed
}: {
  repoId: string;
  prNumber: number;
  currentTitle: string;
  taskId: string;
  taskName: string;
  onRenamed: () => void;
}) {
  const desired = `${taskId} - ${taskName}`;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (currentTitle.trim() === desired.trim()) return null;

  async function rename() {
    setBusy(true);
    setErr(null);
    try {
      await unwrap(api.prs.editTitle(repoId, prNumber, desired));
      onRenamed();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={rename}
      disabled={busy}
      className="shrink-0 text-2xs px-2 h-6 rounded border border-border-muted text-fg-muted hover:text-fg hover:bg-canvas-subtle disabled:opacity-50"
      title={err ?? `Rename PR to: ${desired}`}
    >
      {busy ? 'Renaming…' : err ? 'Retry rename' : 'Use ClickUp title'}
    </button>
  );
}

function Tab({
  id,
  active,
  onClick,
  label,
  count,
  tone
}: {
  id: Tab;
  active: Tab;
  onClick: (t: Tab) => void;
  label: string;
  count?: number;
  tone?: 'danger' | 'attention';
}) {
  const selected = active === id;
  return (
    <button
      role="tab"
      aria-selected={selected}
      onClick={() => onClick(id)}
      className={cn('tab', tone === 'danger' && 'text-danger', tone === 'attention' && 'text-attention')}
    >
      {label}
      {count != null && <span className="ml-1.5 text-2xs text-fg-subtle tabular-nums">{count}</span>}
    </button>
  );
}

/** Jenkins + Vercel status of the PR's branch; opens the Builds tab. */
function BuildsPill({ summary, onClick }: { summary: BuildSummary; onClick: () => void }) {
  if (summary.total === 0) return null;
  const { failed, running, passed, total } = summary;
  const [color, icon, text] =
    failed > 0
      ? ['text-danger border-danger/30', '✕', `${failed} build${failed === 1 ? '' : 's'} failed`]
      : running > 0
        ? ['text-attention border-attention/30', '◔', `${running} building`]
        : ['text-success border-success/30', '●', `${passed}/${total} builds`];
  return (
    <button
      className={`chip ${color} hover:bg-canvas-subtle`}
      onClick={onClick}
      title={`Jenkins & Vercel: ${passed} passed, ${failed} failed, ${running} running`}
    >
      <span>{icon}</span>
      <span>{text}</span>
    </button>
  );
}

/** Header button that shows/hides the AI panel and the review's state. */
function AIToggle({ repoId, prNumber }: { repoId: string; prNumber: number }) {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);
  const session = useAISession(repoId, prNumber).data;
  const count = visibleFindings(session).length;
  return (
    <button
      onClick={toggle}
      className={cn('btn-ghost', !collapsed && 'bg-canvas-subtle text-fg')}
      aria-pressed={!collapsed}
      title={collapsed ? 'Show AI review' : 'Hide AI review'}
    >
      {session?.status === 'running' ? (
        <Spinner size="xs" />
      ) : (
        <Sparkles className={cn('h-3.5 w-3.5', count > 0 && 'text-accent')} />
      )}
      AI
      {session?.status !== 'running' && count > 0 && (
        <span className="text-2xs text-accent tabular-nums">{count}</span>
      )}
    </button>
  );
}

type ReviewLike = { author: { login: string }; state: string; body: string; submittedAt?: string };

/** Reviews with no body that merely wrap inline comments are noise on the timeline. */
function isVisibleReview(r: ReviewLike): boolean {
  return r.body.trim().length > 0 || (r.state !== 'COMMENTED' && r.state !== 'PENDING');
}

function countVisibleReviews(reviews: ReviewLike[]): number {
  return reviews.filter(isVisibleReview).length;
}

type TimelineEntry =
  | { kind: 'review'; at: string; review: ReviewLike }
  | { kind: 'issue'; at: string; comment: PRIssueComment }
  | {
      kind: 'inline';
      at: string;
      comment: { id: number; user: { login: string }; body: string; path: string; line: number | null; createdAt: string };
    };

function Conversation({
  pr,
  comments,
  issueComments,
  issueCommentsLoading,
  issueCommentsError
}: {
  pr: { body: string; reviews: ReviewLike[] };
  comments: { id: number; user: { login: string }; body: string; path: string; line: number | null; createdAt: string }[];
  issueComments: PRIssueComment[];
  issueCommentsLoading: boolean;
  issueCommentsError: string | null;
}) {
  const timeline: TimelineEntry[] = [
    ...pr.reviews
      .filter(isVisibleReview)
      .map((r) => ({ kind: 'review' as const, at: r.submittedAt ?? '', review: r })),
    ...issueComments.map((c) => ({ kind: 'issue' as const, at: c.createdAt, comment: c })),
    ...comments.map((c) => ({ kind: 'inline' as const, at: c.createdAt, comment: c }))
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return (
    <div className="overflow-y-auto p-5 space-y-4">
      {pr.body && (
        <div className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
          <div className="text-2xs text-fg-subtle mb-1">PR description</div>
          <div className="whitespace-pre-wrap text-sm text-fg leading-relaxed">{pr.body}</div>
        </div>
      )}
      {issueCommentsLoading && (
        <div className="text-2xs text-fg-subtle">Loading conversation…</div>
      )}
      {issueCommentsError && (
        <div className="text-2xs text-danger">Couldn't load conversation comments: {issueCommentsError}</div>
      )}
      {timeline.map((entry) => {
        if (entry.kind === 'review') {
          const r = entry.review;
          return (
            <div
              key={`review-${r.author.login}-${entry.at}`}
              className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4"
            >
              <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
                <span className="text-fg">@{r.author.login}</span>
                <ReviewStateLabel state={r.state} />
                {r.submittedAt && <span>· {relativeTime(r.submittedAt)}</span>}
              </div>
              {r.body && <div className="whitespace-pre-wrap text-sm text-fg">{r.body}</div>}
            </div>
          );
        }
        if (entry.kind === 'issue') {
          const c = entry.comment;
          return (
            <div key={`issue-${c.id}`} className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
              <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
                <span className="text-fg">@{c.user.login}</span>
                <span>· {relativeTime(c.createdAt)}</span>
                <a
                  href={c.url}
                  onClick={(e) => {
                    e.preventDefault();
                    api.shell.openExternal(c.url);
                  }}
                  className="ml-auto hover:text-fg hover:underline"
                >
                  open ↗
                </a>
              </div>
              <div className="whitespace-pre-wrap text-sm text-fg">{c.body}</div>
            </div>
          );
        }
        const c = entry.comment;
        return (
          <div key={`inline-${c.id}`} className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
            <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
              <span className="text-fg">@{c.user.login}</span>
              <span>· {relativeTime(c.createdAt)}</span>
              <span>
                · <code className="text-fg-muted">{c.path}</code>
                {c.line != null && ` :${c.line}`}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm text-fg">{c.body}</div>
          </div>
        );
      })}
      {!issueCommentsLoading && timeline.length === 0 && (
        <div className="text-sm text-fg-subtle">No comments or reviews yet.</div>
      )}
    </div>
  );
}

function ReviewStateLabel({ state }: { state: string }) {
  if (state === 'APPROVED') return <span className="text-success">approved</span>;
  if (state === 'CHANGES_REQUESTED') return <span className="text-danger">requested changes</span>;
  if (state === 'COMMENTED') return <span>commented</span>;
  return <span>{state.toLowerCase()}</span>;
}

function Commits({
  commits
}: {
  commits: { oid: string; messageHeadline: string; authoredDate: string; author: { login: string } }[];
}) {
  return (
    <div className="overflow-y-auto p-5">
      <div className="rounded-md border border-border-muted">
        {commits.map((c) => (
          <div
            key={c.oid}
            className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0 border-border-muted"
          >
            <code className="text-2xs text-fg-subtle">{c.oid.slice(0, 7)}</code>
            <span className="flex-1 truncate text-sm">{c.messageHeadline}</span>
            <span className="text-2xs text-fg-muted">@{c.author.login}</span>
            <span className="text-2xs text-fg-subtle">{relativeTime(c.authoredDate)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PRDetailSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
      <div className="px-5 py-4 border-b border-border-muted space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-5 w-2/3" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      </div>
      <div className="px-5 py-2 border-b border-border-muted flex items-center gap-3">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="flex-1 p-4 space-y-3 overflow-hidden">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border-muted overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-border-muted flex items-center gap-2">
              <Skeleton className="h-3.5 w-3.5 rounded-sm" />
              <Skeleton className="h-3.5 w-48" />
              <Skeleton className="h-3.5 w-10 ml-auto" />
            </div>
            <div className="p-3 space-y-1.5">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton
                  key={j}
                  className="h-3"
                  // staggered widths for a more organic feel
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
