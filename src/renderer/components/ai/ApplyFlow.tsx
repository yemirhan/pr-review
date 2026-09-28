import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { api, ApiError, unwrap } from '../../lib/api';
import { cn } from '../../lib/cn';
import { DiffViewer } from '../DiffViewer';
import { Markdown, Pulse } from './Markdown';
import { renderReviewMarkdown } from '@shared/review';
import type { AIApplyPreflight, AIApplyProgress, AIApplyResult, AISession } from '@shared/types';

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

const newStreamId = () => `apply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Let the AI edit the local checkout to address the (non-dismissed)
 * findings, show the resulting diff, then push or discard.
 */
export function ApplyFlow({
  session,
  providerLabel,
  onRequestCheckout,
  checkoutSuccessNonce
}: {
  session: AISession;
  providerLabel: string;
  onRequestCheckout?: () => void;
  checkoutSuccessNonce?: number;
}) {
  const { repoId, prNumber } = session;
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<ApplyState>({ kind: 'idle' });
  const streamRef = useRef<string | null>(null);
  const stRef = useRef(st);
  stRef.current = st;

  const findings = session.findings.filter((f) => !session.dismissed.includes(f.id));

  useEffect(
    () =>
      api.events.onAIApplyProgress(({ streamId, event }) => {
        if (streamId !== streamRef.current || event.kind === 'text') return;
        setSt((cur) => (cur.kind === 'applying' ? { kind: 'applying', events: [...cur.events, event] } : cur));
      }),
    []
  );

  // Cancel a running apply if the panel goes away (e.g. another PR opened).
  useEffect(
    () => () => {
      if (stRef.current.kind === 'applying' && streamRef.current) void api.ai.cancel(streamRef.current);
    },
    []
  );

  async function run() {
    setSt({ kind: 'preflighting' });
    try {
      const pre = await unwrap(api.ai.applyPreflight(repoId, prNumber));
      if (!pre.branchMatches) return setSt({ kind: 'wrong-branch', preflight: pre });
      if (pre.dirty) return setSt({ kind: 'dirty' });
      const id = newStreamId();
      streamRef.current = id;
      setSt({ kind: 'applying', events: [] });
      const review = renderReviewMarkdown({ verdict: session.verdict, findings, notes: session.notes });
      const result = await unwrap(api.ai.apply(repoId, prNumber, review, id));
      setSt({ kind: 'applied', result, commitMessage: result.commitMessage });
    } catch (e) {
      const err = e as ApiError;
      setSt(err.code === 'AI_CANCELLED' ? { kind: 'idle' } : { kind: 'error', error: err });
    }
  }

  // Retry automatically once the PR was checked out from the wrong-branch state.
  useEffect(() => {
    if (checkoutSuccessNonce && stRef.current.kind === 'wrong-branch') void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutSuccessNonce]);

  async function push() {
    if (st.kind !== 'applied') return;
    setSt({ kind: 'pushing', result: st.result, commitMessage: st.commitMessage });
    try {
      await unwrap(api.ai.push(repoId, prNumber, st.commitMessage));
      setSt({ kind: 'pushed' });
    } catch (e) {
      setSt({ kind: 'error', error: e as ApiError });
    }
  }

  async function discard() {
    if (st.kind !== 'applied') return;
    try {
      await unwrap(api.ai.discard(repoId, prNumber, st.result.untrackedBefore));
      setSt({ kind: 'idle' });
    } catch (e) {
      setSt({ kind: 'error', error: e as ApiError });
    }
  }

  if (findings.length === 0 && st.kind === 'idle') return null;
  const expanded = open || st.kind !== 'idle';
  const reset = () => setSt({ kind: 'idle' });

  return (
    <section className="border-t border-border-muted pt-3">
      <button
        className="w-full flex items-center gap-1.5 text-left text-xs text-fg-muted hover:text-fg"
        onClick={() => setOpen((o) => !o)}
        disabled={st.kind !== 'idle'}
      >
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
        Apply fixes locally
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-sm">
          {st.kind === 'idle' && (
            <>
              <p className="text-fg-muted leading-relaxed">
                {providerLabel} edits this PR's worktree to address the {findings.length}{' '}
                {findings.length === 1 ? 'finding' : 'findings'} above (dismissed ones are skipped). It works in
                the PR's worktree, which must be clean; you see the diff before anything is pushed.
              </p>
              <button className="btn" onClick={run}>
                Apply with {providerLabel}
              </button>
            </>
          )}
          {st.kind === 'preflighting' && <Pulse text="Checking working tree…" />}
          {st.kind === 'wrong-branch' && (
            <div className="space-y-2 text-fg-muted">
              <p>Fixes are applied in this PR's own worktree, so your main checkout stays untouched. Check it out first.</p>
              <div className="flex gap-2">
                {onRequestCheckout && (
                  <button className="btn" onClick={onRequestCheckout}>
                    Check out in worktree
                  </button>
                )}
                <button className="btn-ghost" onClick={reset}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {st.kind === 'dirty' && (
            <div className="space-y-2 text-fg-muted">
              <p>The PR's worktree has uncommitted changes. Commit or stash them first.</p>
              <button className="btn-ghost" onClick={reset}>
                OK
              </button>
            </div>
          )}
          {st.kind === 'applying' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Pulse text={`${providerLabel} is editing files…`} />
                <button className="btn-ghost text-xs" onClick={() => streamRef.current && api.ai.cancel(streamRef.current)}>
                  Cancel
                </button>
              </div>
              {st.events.length > 0 && (
                <ul className="space-y-0.5 text-2xs text-fg-muted font-mono max-h-40 overflow-y-auto">
                  {st.events.map((e, i) =>
                    e.kind === 'tool' ? (
                      <li key={i} className="flex gap-2">
                        <span className="text-fg-subtle shrink-0">{e.name}</span>
                        <span className="truncate">{e.path ?? ''}</span>
                      </li>
                    ) : null
                  )}
                </ul>
              )}
            </div>
          )}
          {(st.kind === 'applied' || st.kind === 'pushing') && (
            <div className="space-y-3">
              {st.result.assistantText && <Markdown text={st.result.assistantText} />}
              <div className="border border-border-muted rounded-md overflow-hidden max-h-[420px] flex flex-col">
                <DiffViewer
                  loading={false}
                  error={null}
                  files={st.result.diff}
                  threads={[]}
                  repoId={repoId}
                  prNumber={prNumber}
                  headOid={session.headOid}
                  readOnly
                />
              </div>
              <textarea
                className="input w-full h-auto py-1.5 font-mono text-xs resize-y min-h-[2.5rem]"
                value={st.commitMessage}
                onChange={(e) => st.kind === 'applied' && setSt({ ...st, commitMessage: e.target.value })}
                disabled={st.kind === 'pushing'}
              />
              <div className="flex items-center gap-2">
                <button
                  className="btn-primary"
                  onClick={push}
                  disabled={st.kind === 'pushing' || !st.commitMessage.trim() || st.result.diff.length === 0}
                >
                  {st.kind === 'pushing' ? 'Pushing…' : 'Commit & push'}
                </button>
                <button className="btn-ghost" onClick={discard} disabled={st.kind === 'pushing'}>
                  Discard
                </button>
              </div>
            </div>
          )}
          {st.kind === 'pushed' && (
            <div className="flex items-center gap-2 text-success">
              Pushed to the PR branch.
              <button className="btn-ghost" onClick={reset}>
                Done
              </button>
            </div>
          )}
          {st.kind === 'error' && (
            <div className="space-y-2">
              <div className="text-danger text-sm whitespace-pre-wrap">{st.error.message}</div>
              <button className="btn-ghost" onClick={reset}>
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
