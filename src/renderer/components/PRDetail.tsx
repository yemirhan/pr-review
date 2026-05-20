import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { relativeTime } from '../lib/format';
import { ChecksPill } from './ChecksPill';
import { DiffViewer } from './DiffViewer';
import { ReviewBar } from './ReviewBar';
import { MergeModal } from './MergeModal';
import { CheckoutModal } from './CheckoutModal';
import { ConflictsView } from './ConflictsView';
import { ChecksView } from './ChecksView';
import { PRActionsMenu } from './PRActionsMenu';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { AIReviewPanel } from './AIReviewPanel';
import { FileTree } from './FileTree';
import { FileTreeAside } from './FileTreeAside';
import { DiffSearchBar, type DiffSearchBarHandle } from './DiffSearchBar';
import { useDiffSearch, useScrollToMatch } from '../lib/diffSearch';
import { ClickUpTaskTab } from './integrations/ClickUpTaskTab';
import { ClickUpCommentsTab } from './integrations/ClickUpCommentsTab';
import { JenkinsBuildsTab } from './integrations/JenkinsBuildsTab';
import type { Repo } from '@shared/types';

type Tab =
  | 'files'
  | 'conversation'
  | 'commits'
  | 'checks'
  | 'conflicts'
  | 'clickup-task'
  | 'clickup-comments'
  | 'jenkins';

export function PRDetail({ repo, prNumber }: { repo: Repo | null; prNumber: number | null }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('files');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSuccessNonce, setCheckoutSuccessNonce] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null);
  const diffScrollRef = useRef<HTMLDivElement>(null);
  const searchBarRef = useRef<DiffSearchBarHandle>(null);

  const detailQ = useQuery({
    queryKey: repo && prNumber != null ? qk.prDetail(repo.id, prNumber) : ['no-detail'],
    queryFn: () => unwrap(api.prs.get(repo!.id, prNumber!)),
    enabled: !!repo && prNumber != null
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

  const jenkinsCfgQ = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig()),
    staleTime: 60_000
  });
  const jenkinsAvailable =
    !!repo &&
    !!jenkinsCfgQ.data?.baseUrl &&
    !!jenkinsCfgQ.data.username &&
    !!jenkinsCfgQ.data.apiToken &&
    (jenkinsCfgQ.data.repos[repo.id]?.pipelines.length ?? 0) > 0;

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
      if (frame) return;
      frame = requestAnimationFrame(update);
    }
    container.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [filesQ.data, tab]);

  const onSelectFileFromTree = useCallback((path: string) => {
    // Scroll the file's header into view at the top of the diff container.
    const container = diffScrollRef.current;
    if (!container) return;
    const sel = `[data-file-header="${path.replace(/(["\\])/g, '\\$1')}"]`;
    const target = container.querySelector(sel) as HTMLElement | null;
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

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

  function invalidatePR() {
    if (!repo || prNumber == null) return;
    qc.invalidateQueries({ queryKey: qk.prDetail(repo.id, prNumber) });
    qc.invalidateQueries({ queryKey: qk.prs(repo.id) });
    qc.invalidateQueries({ queryKey: qk.prComments(repo.id, prNumber) });
    if (branchForClickUp) {
      qc.invalidateQueries({ queryKey: qk.clickupTaskByBranch(repo.id, branchForClickUp) });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-canvas">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border-muted">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
              <a
                href={pr.url}
                onClick={(e) => {
                  e.preventDefault();
                  api.shell.openExternal(pr.url);
                }}
                className="hover:text-fg hover:underline"
              >
                #{pr.number}
              </a>
              <span>·</span>
              <span>@{pr.author.login}</span>
              <span>·</span>
              <span>opened {relativeTime(pr.createdAt)}</span>
              <span>·</span>
              <span className="font-mono">
                {pr.headRefName} → {pr.baseRefName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] truncate text-fg">
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
            <div className="flex items-center gap-2 mt-2">
              {pr.isDraft && <span className="chip">Draft</span>}
              <ChecksPill checks={pr.checks} />
              {clickupLinked && (
                <button
                  className="inline-flex items-center gap-1.5 px-2 h-5 rounded text-2xs font-medium hover:opacity-90"
                  style={{
                    backgroundColor: `${clickupLinked.task.status.color}22`,
                    color: clickupLinked.task.status.color,
                    border: `1px solid ${clickupLinked.task.status.color}66`
                  }}
                  onClick={() => api.shell.openExternal(clickupLinked.task.url)}
                  title={`${clickupLinked.task.name} — open in ClickUp`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: clickupLinked.task.status.color }}
                  />
                  <span className="font-mono">{clickupLinked.task.customId || clickupLinked.task.id}</span>
                  <span className="opacity-70">·</span>
                  <span>{clickupLinked.task.status.status}</span>
                </button>
              )}
              {!clickupLinked && clickupResult && clickupResult.reason !== 'no-token' && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 h-5 rounded text-2xs font-medium text-fg-subtle border border-border-muted"
                  title={
                    clickupResult.reason === 'no-id'
                      ? `Couldn't parse a task ID from branch "${pr.headRefName}". Expected format: <project>-<digits>-<slug>.`
                      : clickupResult.reason === 'not-found'
                        ? `Task ${clickupResult.parsedTaskId} not found in ClickUp (or token lacks access).`
                        : 'No ClickUp task linked.'
                  }
                >
                  ClickUp:{' '}
                  {clickupResult.reason === 'no-id'
                    ? 'no task in branch'
                    : `${clickupResult.parsedTaskId} not found`}
                </span>
              )}
              {clickupQ.error && (
                <span
                  className="inline-flex items-center gap-1.5 px-2 h-5 rounded text-2xs font-medium text-danger border border-danger-emphasis/40"
                  title={(clickupQ.error as ApiError).message}
                >
                  ClickUp error
                </span>
              )}
              <span className="text-2xs text-fg-subtle">
                <span className="text-success">+{pr.additions}</span>{' '}
                <span className="text-danger">−{pr.deletions}</span> ·{' '}
                {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <PRActionsMenu
              prUrl={pr.url}
              repoId={repo.id}
              onCheckout={() => setCheckoutOpen(true)}
            />
            <Button
              variant="primary"
              disabled={pr.mergeable !== true}
              onClick={() => setMergeOpen(true)}
              title={
                pr.mergeable === true
                  ? 'Merge this PR'
                  : `Not mergeable (${pr.mergeStateStatus || 'state unknown'})`
              }
            >
              Merge…
            </Button>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          <Tab id="files" active={tab} onClick={setTab} label={`Files (${pr.changedFiles})`} />
          <Tab
            id="conversation"
            active={tab}
            onClick={setTab}
            label={`Conversation (${(commentsQ.data?.length ?? 0) + pr.reviews.length})`}
          />
          <Tab id="commits" active={tab} onClick={setTab} label={`Commits (${pr.commits.length})`} />
          <Tab
            id="checks"
            active={tab}
            onClick={setTab}
            label={`Checks${pr.checks.total > 0 ? ` (${pr.checks.passed}/${pr.checks.total})` : ''}`}
            tone={
              pr.checks.state === 'FAILURE'
                ? 'danger'
                : pr.checks.state === 'PENDING'
                  ? 'attention'
                  : undefined
            }
          />
          {pr.mergeable === false && (
            <Tab
              id="conflicts"
              active={tab}
              onClick={setTab}
              label="Conflicts"
              tone="danger"
            />
          )}
          {clickupLinked && (
            <>
              <Tab id="clickup-task" active={tab} onClick={setTab} label="ClickUp Task" />
              <Tab id="clickup-comments" active={tab} onClick={setTab} label="Task Comments" />
            </>
          )}
          {jenkinsAvailable && (
            <Tab id="jenkins" active={tab} onClick={setTab} label="Jenkins" />
          )}
        </div>
      </div>

      {/* Content + always-visible AI panel */}
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
                    lineMatchMap={search.lineMatchMap}
                    activeMatch={activeMatch}
                    filesWithMatches={search.filesWithMatches}
                  />
                </div>
              </div>
            )}
            {tab === 'conversation' && <Conversation pr={pr} comments={commentsQ.data ?? []} />}
            {tab === 'commits' && <Commits commits={pr.commits} />}
            {tab === 'checks' && <ChecksView repo={repo} prNumber={pr.number} />}
            {tab === 'conflicts' && (
              <ConflictsView repo={repo} prNumber={pr.number} baseRefName={pr.baseRefName} />
            )}
            {tab === 'clickup-task' && clickupLinked && (
              <ClickUpTaskTab task={clickupLinked.task} />
            )}
            {tab === 'clickup-comments' && clickupLinked && (
              <ClickUpCommentsTab taskId={clickupLinked.task.id} />
            )}
            {tab === 'jenkins' && (
              <JenkinsBuildsTab repo={repo} branch={pr.headRefName} />
            )}
          </div>

          {tab === 'files' && (
            <ReviewBar
              repo={repo}
              prNumber={prNumber}
              headOid={pr.headRefOid}
              onSubmitted={invalidatePR}
            />
          )}
        </div>

        <AIReviewPanel
          repoId={repo.id}
          prNumber={pr.number}
          headOid={pr.headRefOid}
          onRequestCheckout={() => setCheckoutOpen(true)}
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
            invalidatePR();
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
  tone
}: {
  id: Tab;
  active: Tab;
  onClick: (t: Tab) => void;
  label: string;
  tone?: 'danger' | 'attention';
}) {
  const selected = active === id;
  const toneSel =
    tone === 'danger' && selected
      ? 'bg-danger-subtle text-danger border border-danger/40'
      : tone === 'attention' && selected
        ? 'bg-attention-subtle text-attention border border-attention/40'
        : null;
  const toneIdle =
    tone === 'danger' && !selected
      ? 'text-danger hover:bg-danger-subtle/40 border border-transparent'
      : tone === 'attention' && !selected
        ? 'text-attention hover:bg-attention-subtle/40 border border-transparent'
        : null;
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-3 h-7 rounded-md text-sm font-medium transition-colors ${
        toneSel ??
        toneIdle ??
        (selected
          ? 'bg-canvas-overlay text-fg border border-border'
          : 'text-fg-muted hover:text-fg hover:bg-canvas-subtle border border-transparent')
      }`}
    >
      {label}
    </button>
  );
}

function Conversation({
  pr,
  comments
}: {
  pr: { body: string; reviews: { author: { login: string }; state: string; body: string; submittedAt?: string }[] };
  comments: { id: number; user: { login: string }; body: string; path: string; line: number | null; createdAt: string }[];
}) {
  return (
    <div className="overflow-y-auto p-5 space-y-4">
      {pr.body && (
        <div className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
          <div className="text-2xs text-fg-subtle mb-1">PR description</div>
          <div className="whitespace-pre-wrap text-sm text-fg leading-relaxed">{pr.body}</div>
        </div>
      )}
      {pr.reviews.map((r, i) => (
        <div key={i} className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
          <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
            <span className="text-fg">@{r.author.login}</span>
            <ReviewStateLabel state={r.state} />
            {r.submittedAt && <span>· {relativeTime(r.submittedAt)}</span>}
          </div>
          {r.body && <div className="whitespace-pre-wrap text-sm text-fg">{r.body}</div>}
        </div>
      ))}
      {comments.map((c) => (
        <div key={c.id} className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
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
      ))}
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
