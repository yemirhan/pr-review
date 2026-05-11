import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
import type { Repo } from '@shared/types';

type Tab = 'files' | 'conversation' | 'commits' | 'conflicts';

export function PRDetail({ repo, prNumber }: { repo: Repo | null; prNumber: number | null }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('files');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

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
            <div className="flex-1 min-w-0 flex flex-col">
              <DiffViewer
                loading={filesQ.isLoading}
                error={filesQ.error as ApiError | null}
                files={filesQ.data ?? []}
                threads={commentsQ.data ?? []}
                repoId={repo.id}
                prNumber={pr.number}
                headOid={pr.headRefOid}
              />
            </div>
            <AIReviewPanel repoId={repo.id} prNumber={pr.number} />
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
        <CheckoutModal repo={repo} prNumber={prNumber} onClose={() => setCheckoutOpen(false)} />
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
