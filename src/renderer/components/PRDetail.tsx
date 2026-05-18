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
import { EditorMenu } from './EditorMenu';
import { AIReviewPanel } from './AIReviewPanel';
import { FileTree } from './FileTree';
import { DiffSearchBar, type DiffSearchBarHandle } from './DiffSearchBar';
import { useDiffSearch, useScrollToMatch } from '../lib/diffSearch';
import type { Repo } from '@shared/types';

type Tab = 'files' | 'conversation' | 'commits' | 'conflicts';

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
    return <div className="flex-1 flex items-center justify-center text-fg-muted">Loading…</div>;
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
            <h1 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] truncate text-fg">
              {pr.title}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              {pr.isDraft && <span className="chip">Draft</span>}
              <ChecksPill checks={pr.checks} />
              <span className="text-2xs text-fg-subtle">
                <span className="text-success">+{pr.additions}</span>{' '}
                <span className="text-danger">−{pr.deletions}</span> ·{' '}
                {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              className="btn"
              onClick={() => api.shell.openExternal(pr.url)}
              title="Open this PR on github.com"
            >
              Open on GitHub
            </button>
            <EditorMenu repoId={repo.id} />
            <button className="btn" onClick={() => setCheckoutOpen(true)}>
              Checkout locally
            </button>
            <button
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={pr.mergeable !== true}
              onClick={() => setMergeOpen(true)}
              title={
                pr.mergeable === true
                  ? 'Merge this PR'
                  : `Not mergeable (${pr.mergeStateStatus || 'state unknown'})`
              }
            >
              Merge…
            </button>
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
          {pr.mergeable === false && (
            <Tab
              id="conflicts"
              active={tab}
              onClick={setTab}
              label="Conflicts"
              tone="danger"
            />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {tab === 'files' && (
          <div className="flex-1 min-h-0 flex">
            <aside className="w-[260px] shrink-0 border-r border-border-muted bg-canvas-subtle/30 overflow-y-auto">
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
            </aside>
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
            <AIReviewPanel
              repoId={repo.id}
              prNumber={pr.number}
              headOid={pr.headRefOid}
              onRequestCheckout={() => setCheckoutOpen(true)}
              checkoutSuccessNonce={checkoutSuccessNonce}
            />
          </div>
        )}
        {tab === 'conversation' && <Conversation pr={pr} comments={commentsQ.data ?? []} />}
        {tab === 'commits' && <Commits commits={pr.commits} />}
        {tab === 'conflicts' && (
          <ConflictsView repo={repo} prNumber={pr.number} baseRefName={pr.baseRefName} />
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
  tone?: 'danger';
}) {
  const selected = active === id;
  const dangerSel = tone === 'danger' && selected;
  const dangerIdle = tone === 'danger' && !selected;
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-3 h-7 rounded-md text-sm font-medium transition-colors ${
        dangerSel
          ? 'bg-danger-subtle text-danger border border-danger/40'
          : dangerIdle
            ? 'text-danger hover:bg-danger-subtle/40 border border-transparent'
            : selected
              ? 'bg-canvas-overlay text-fg border border-border'
              : 'text-fg-muted hover:text-fg hover:bg-canvas-subtle border border-transparent'
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
