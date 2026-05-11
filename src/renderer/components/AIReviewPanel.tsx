import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError, qk, unwrap } from '../lib/api';
import { useUI } from '../store/ui';
import { DiffViewer } from './DiffViewer';
import type {
  AIApplyPreflight,
  AIApplyProgress,
  AIApplyResult
} from '@shared/types';

interface Props {
  repoId: string;
  prNumber: number;
  headOid: string;
  /** Triggered when the panel wants the user to checkout the PR. */
  onRequestCheckout?: () => void;
  /** Bumped each time a checkout succeeds; lets us auto-retry apply. */
  checkoutSuccessNonce?: number;
}

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'preflighting' }
  | { kind: 'wrong-branch'; preflight: AIApplyPreflight }
  | { kind: 'dirty' }
  | { kind: 'applying'; events: AIApplyProgress[] }
  | { kind: 'applied'; result: AIApplyResult; commitMessage: string }
  | { kind: 'pushing'; result: AIApplyResult; commitMessage: string }
  | { kind: 'pushed' }
  | { kind: 'error'; error: ApiError };

export function AIReviewPanel({
  repoId,
  prNumber,
  headOid,
  onRequestCheckout,
  checkoutSuccessNonce
}: Props) {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);
  const qc = useQueryClient();

  const [streamed, setStreamed] = useState('');
  const streamedRef = useRef('');

  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });
  const applyStateRef = useRef<ApplyState>(applyState);
  useEffect(() => {
    applyStateRef.current = applyState;
  }, [applyState]);

  const authQ = useQuery({
    queryKey: qk.aiAuth,
    queryFn: () => unwrap(api.ai.authStatus()),
    staleTime: 60_000
  });

  const reviewM = useMutation({
    mutationKey: qk.aiReview(repoId, prNumber),
    mutationFn: async () => {
      streamedRef.current = '';
      setStreamed('');
      return unwrap(api.ai.review(repoId, prNumber));
    }
  });

  // Reset everything when switching PRs.
  useEffect(() => {
    streamedRef.current = '';
    setStreamed('');
    setApplyState({ kind: 'idle' });
    reviewM.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, prNumber]);

  // Stream review chunks.
  useEffect(() => {
    const off = api.events.onAIReviewChunk((chunk) => {
      if (chunk.prNumber !== prNumber) return;
      streamedRef.current += chunk.text;
      setStreamed(streamedRef.current);
    });
    return off;
  }, [prNumber]);

  // Stream apply progress.
  useEffect(() => {
    const off = api.events.onAIApplyProgress((event) => {
      const cur = applyStateRef.current;
      if (cur.kind !== 'applying') return;
      // Ignore noisy text chunks during apply — final text comes back in the result.
      if (event.kind === 'text') return;
      setApplyState({ kind: 'applying', events: [...cur.events, event] });
    });
    return off;
  }, []);

  // When a checkout succeeds AND we were waiting for it, retry the apply
  // preflight automatically. Skip the very first render (nonce=0).
  useEffect(() => {
    if (!checkoutSuccessNonce) return;
    const cur = applyStateRef.current;
    if (cur.kind !== 'wrong-branch') return;
    const review = reviewM.data?.summary;
    if (!review) return;
    runApply(review);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutSuccessNonce]);

  async function runApply(review: string) {
    setApplyState({ kind: 'preflighting' });
    try {
      const pre = await unwrap(api.ai.applyPreflight(repoId, prNumber));
      if (!pre.branchMatches) {
        setApplyState({ kind: 'wrong-branch', preflight: pre });
        return;
      }
      if (pre.dirty) {
        setApplyState({ kind: 'dirty' });
        return;
      }
      setApplyState({ kind: 'applying', events: [] });
      const result = await unwrap(api.ai.apply(repoId, prNumber, review));
      setApplyState({
        kind: 'applied',
        result,
        commitMessage: result.commitMessage
      });
    } catch (e) {
      setApplyState({ kind: 'error', error: e as ApiError });
    }
  }

  async function runPush() {
    if (applyState.kind !== 'applied') return;
    const { result, commitMessage } = applyState;
    setApplyState({ kind: 'pushing', result, commitMessage });
    try {
      await unwrap(api.ai.push(repoId, commitMessage));
      setApplyState({ kind: 'pushed' });
      qc.invalidateQueries({ queryKey: qk.prDetail(repoId, prNumber) });
      qc.invalidateQueries({ queryKey: qk.prFiles(repoId, prNumber) });
      qc.invalidateQueries({ queryKey: qk.prs(repoId) });
    } catch (e) {
      setApplyState({ kind: 'error', error: e as ApiError });
    }
  }

  async function runDiscard() {
    if (applyState.kind !== 'applied') return;
    const untracked = applyState.result.untrackedBefore;
    try {
      await unwrap(api.ai.discard(repoId, untracked));
      setApplyState({ kind: 'idle' });
    } catch (e) {
      setApplyState({ kind: 'error', error: e as ApiError });
    }
  }

  if (collapsed) return null;

  const finalSummary = reviewM.data?.summary ?? '';
  const showStreaming = reviewM.isPending && streamed.length > 0;
  const showError = !!reviewM.error;
  const apiError = reviewM.error as ApiError | undefined;
  const authBlocked = authQ.data?.available === false;
  const hasApply = applyState.kind !== 'idle';

  return (
    <aside
      className={`${hasApply ? 'w-[580px]' : 'w-[360px]'} shrink-0 border-l border-border-muted bg-canvas-subtle/30 flex flex-col min-h-0 transition-[width] duration-200 ease-smooth`}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-subtle">
          <span>AI review</span>
          {authQ.data?.source === 'claude-code' && (
            <span className="text-fg-muted normal-case tracking-normal" title="Using local Claude Code credentials">
              · claude code
            </span>
          )}
          {authQ.data?.source === 'api-key' && (
            <span className="text-fg-muted normal-case tracking-normal" title="Using ANTHROPIC_API_KEY">
              · api key
            </span>
          )}
        </div>
        <button
          onClick={toggle}
          className="text-2xs text-fg-subtle hover:text-fg"
          title="Hide panel"
        >
          ‹
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {authBlocked ? (
          <AuthMissing />
        ) : reviewM.isPending && streamed.length === 0 ? (
          <Status text="Asking Claude…" />
        ) : showStreaming ? (
          <Markdown text={streamed} streaming />
        ) : reviewM.isSuccess ? (
          <>
            <Markdown text={finalSummary} />
            <ApplyArea
              applyState={applyState}
              repoId={repoId}
              prNumber={prNumber}
              headOid={headOid}
              onRun={() => runApply(finalSummary)}
              onPush={runPush}
              onDiscard={runDiscard}
              onCheckoutRequest={onRequestCheckout}
              onCommitMessageChange={(msg) => {
                if (applyState.kind === 'applied')
                  setApplyState({ ...applyState, commitMessage: msg });
              }}
              onReset={() => setApplyState({ kind: 'idle' })}
            />
          </>
        ) : showError ? (
          <ErrorBox error={apiError!} />
        ) : (
          <Idle />
        )}
      </div>

      <div className="border-t border-border-muted p-3 shrink-0 flex items-center gap-2">
        <button
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => reviewM.mutate()}
          disabled={reviewM.isPending || authBlocked}
        >
          {reviewM.isPending
            ? 'Reviewing…'
            : reviewM.isSuccess || showError
              ? 'Re-run AI review'
              : 'Run AI review'}
        </button>
        {reviewM.data?.costUSD != null && reviewM.data.costUSD > 0 && (
          <span
            className="text-2xs text-fg-subtle"
            title={
              authQ.data?.source === 'claude-code'
                ? 'API-equivalent value of tokens used. Covered by your Claude subscription — not billed.'
                : 'Billed via ANTHROPIC_API_KEY.'
            }
          >
            {authQ.data?.source === 'claude-code' ? '≈ ' : ''}${reviewM.data.costUSD.toFixed(4)}
            {authQ.data?.source === 'claude-code' && (
              <span className="ml-1 text-fg-subtle/70">API-eq.</span>
            )}
          </span>
        )}
      </div>
    </aside>
  );
}

interface ApplyAreaProps {
  applyState: ApplyState;
  repoId: string;
  prNumber: number;
  headOid: string;
  onRun: () => void;
  onPush: () => void;
  onDiscard: () => void;
  onReset: () => void;
  onCheckoutRequest?: () => void;
  onCommitMessageChange: (msg: string) => void;
}

function ApplyArea({
  applyState,
  repoId,
  prNumber,
  headOid,
  onRun,
  onPush,
  onDiscard,
  onReset,
  onCheckoutRequest,
  onCommitMessageChange
}: ApplyAreaProps) {
  return (
    <div className="mt-4 pt-4 border-t border-border-muted">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle mb-2">
        Apply suggestions
      </div>

      {applyState.kind === 'idle' && (
        <>
          <p className="text-sm text-fg-muted mb-2 leading-relaxed">
            Run Claude with edit access to apply the suggestions above. The PR
            must be checked out locally with a clean working tree.
          </p>
          <button className="btn-primary" onClick={onRun}>
            Apply changes
          </button>
        </>
      )}

      {applyState.kind === 'preflighting' && (
        <Status text="Checking working tree…" />
      )}

      {applyState.kind === 'wrong-branch' && (
        <div className="text-sm text-fg-muted leading-relaxed space-y-2">
          <p>
            Repo is on <code className="font-mono text-fg">{applyState.preflight.currentBranch}</code>,
            but the PR head is the PR's own branch. Check out the PR first.
          </p>
          {onCheckoutRequest && (
            <button className="btn-primary" onClick={onCheckoutRequest}>
              Checkout PR locally
            </button>
          )}
          <button className="btn ml-2" onClick={onReset}>
            Cancel
          </button>
        </div>
      )}

      {applyState.kind === 'dirty' && (
        <div className="text-sm text-fg-muted leading-relaxed space-y-2">
          <p>
            Your working tree has uncommitted changes. Commit or stash them
            before applying AI changes — we won't touch existing work.
          </p>
          <button className="btn" onClick={onReset}>
            Dismiss
          </button>
        </div>
      )}

      {applyState.kind === 'applying' && (
        <div className="text-sm space-y-2">
          <Status text="Claude is editing files…" />
          {applyState.events.length > 0 && (
            <ul className="space-y-1 text-2xs text-fg-muted font-mono max-h-40 overflow-y-auto border border-border-muted rounded p-2 bg-canvas/40">
              {applyState.events.map((e, i) =>
                e.kind === 'tool' ? (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent shrink-0">{e.name}</span>
                    <span className="truncate text-fg">{e.path ?? ''}</span>
                  </li>
                ) : null
              )}
            </ul>
          )}
        </div>
      )}

      {(applyState.kind === 'applied' || applyState.kind === 'pushing') && (
        <div className="space-y-3">
          {applyState.result.assistantText && (
            <Markdown text={applyState.result.assistantText} />
          )}
          <div>
            <div className="text-2xs uppercase tracking-wide text-fg-subtle mb-1">
              Changes ({applyState.result.diff.length}{' '}
              {applyState.result.diff.length === 1 ? 'file' : 'files'})
            </div>
            <div className="border border-border-muted rounded-md overflow-hidden max-h-[420px] flex flex-col">
              <DiffViewer
                loading={false}
                error={null}
                files={applyState.result.diff}
                threads={[]}
                repoId={repoId}
                prNumber={prNumber}
                headOid={headOid}
              />
            </div>
          </div>
          <div>
            <label className="text-2xs uppercase tracking-wide text-fg-subtle block mb-1">
              Commit message
            </label>
            <textarea
              className="w-full bg-canvas border border-border-muted rounded-md px-2 py-1.5 text-sm font-mono text-fg resize-y min-h-[2.5rem]"
              value={applyState.commitMessage}
              onChange={(e) => onCommitMessageChange(e.target.value)}
              disabled={applyState.kind === 'pushing'}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onPush}
              disabled={
                applyState.kind === 'pushing' ||
                applyState.commitMessage.trim().length === 0 ||
                applyState.result.diff.length === 0
              }
            >
              {applyState.kind === 'pushing' ? 'Pushing…' : 'Push to branch'}
            </button>
            <button
              className="btn disabled:opacity-50"
              onClick={onDiscard}
              disabled={applyState.kind === 'pushing'}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {applyState.kind === 'pushed' && (
        <div className="text-sm text-success">
          Pushed to branch.
          <button className="btn ml-2" onClick={onReset}>
            Done
          </button>
        </div>
      )}

      {applyState.kind === 'error' && (
        <div className="space-y-2">
          <ErrorBox error={applyState.error} />
          <button className="btn" onClick={onReset}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function Idle() {
  return (
    <div className="text-sm text-fg-muted leading-relaxed">
      <p>
        Run an on-demand review of this PR with Claude. The model is sent the
        diff and PR description; it has no tool access and cannot read other
        files.
      </p>
      <p className="mt-2 text-2xs text-fg-subtle">
        Returns a markdown summary with Overview · Concerns · Suggestions.
      </p>
    </div>
  );
}

function Status({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted">
      <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
      {text}
    </div>
  );
}

function AuthMissing() {
  return (
    <div className="text-sm text-fg-muted leading-relaxed">
      <div className="text-danger text-2xs uppercase tracking-wide mb-2">
        Not authenticated
      </div>
      <p>Claude is not authenticated on this machine.</p>
      <p className="mt-2">
        Either sign in with <code className="font-mono text-fg">claude</code> on
        the command line, or set <code className="font-mono text-fg">ANTHROPIC_API_KEY</code> in
        your shell before launching the app.
      </p>
    </div>
  );
}

function ErrorBox({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-danger-emphasis/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
      <div className="text-2xs uppercase tracking-wide mb-1">{error.code}</div>
      <div className="whitespace-pre-wrap">{error.message}</div>
    </div>
  );
}

function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="ai-md text-sm text-fg leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h2 className="text-base font-semibold mt-3 mb-2 text-fg" {...p} />,
          h2: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-fg" {...p} />,
          h3: (p) => <h4 className="text-sm font-semibold mt-2 mb-1 text-fg" {...p} />,
          p: (p) => <p className="mb-2 text-fg" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...p} />,
          li: (p) => <li className="text-fg" {...p} />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? '');
            return isBlock ? (
              <code className="block bg-canvas-overlay border border-border-muted rounded px-2 py-1.5 text-2xs font-mono overflow-x-auto whitespace-pre" {...rest}>
                {children}
              </code>
            ) : (
              <code className="font-mono text-2xs bg-canvas-overlay px-1 py-0.5 rounded text-fg" {...rest}>
                {children}
              </code>
            );
          },
          pre: (p) => <pre className="mb-2 not-prose" {...p} />,
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) api.shell.openExternal(href);
              }}
              className="text-accent hover:underline"
              {...rest}
            >
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-1.5 h-3.5 -mb-0.5 bg-fg-muted animate-pulse align-middle" />
      )}
    </div>
  );
}
