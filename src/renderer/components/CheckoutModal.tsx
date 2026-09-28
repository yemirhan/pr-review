import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Terminal } from 'lucide-react';
import { Backdrop } from './MergeModal';
import { api, ApiError, qk, unwrap } from '../lib/api';
import { useInvalidateWorkspaces } from '../lib/workspaces';
import type { PRWorkspace, Repo } from '@shared/types';

/**
 * Check a PR out into its own git worktree (`<repo>.worktrees/pr-<n>`), so
 * several PRs can be checked out at once and the main checkout never
 * switches branches. Starts immediately and streams git/gh output.
 */
export function CheckoutModal({
  repo,
  prNumber,
  onClose,
  onSuccess
}: {
  repo: Repo;
  prNumber: number;
  onClose: () => void;
  /** Fired once the worktree is ready. */
  onSuccess?: () => void;
}) {
  const [lines, setLines] = useState<{ channel: string; data: string }[]>([]);
  const [ws, setWs] = useState<PRWorkspace | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);
  const invalidate = useInvalidateWorkspaces();
  const editorsQ = useQuery({
    queryKey: qk.editors,
    queryFn: () => unwrap(api.editors.list()),
    staleTime: 5 * 60_000
  });
  const started = useRef(false);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    setLines([]);
    setErr(null);
    setWs(null);
    setRunning(true);
    const off = api.events.onCheckoutProgress((msg) => {
      if (msg.channel === 'done') return;
      setLines((l) => [...l, { channel: msg.channel === 'error' ? 'stderr' : msg.channel, data: msg.data }]);
    });
    try {
      const result = await unwrap(api.review.checkout(repo.id, prNumber));
      setWs(result);
      await invalidate();
      onSuccess?.();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setRunning(false);
      off();
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editor = editorsQ.data?.[0];

  return (
    <Backdrop onClose={onClose}>
      <div className="w-[640px] rounded-lg border border-border bg-canvas-overlay shadow-2xl p-5 animate-slide-up">
        <h2 className="text-base font-semibold mb-1">Check out #{prNumber} in a worktree</h2>
        <p className="text-xs text-fg-muted mb-3">
          Your main checkout in <code className="text-fg">{repo.path}</code> stays on its current branch.
        </p>
        <pre
          ref={consoleRef}
          className="h-56 overflow-auto rounded-md bg-canvas-inset border border-border-muted p-3 text-2xs font-mono text-fg-muted whitespace-pre-wrap"
        >
          {lines.map((l, i) => (
            <span key={i} className={l.channel === 'stderr' ? 'text-attention' : ''}>
              {l.data}
            </span>
          ))}
          {running && lines.length === 0 && <span className="text-fg-subtle">Starting…</span>}
        </pre>
        {ws && (
          <div className="mt-3 text-sm text-fg">
            Checked out <code className="font-mono">{ws.branch}</code> at{' '}
            <code className="font-mono text-fg-muted">{ws.path}</code>
          </div>
        )}
        {err && <div className="mt-3 text-sm text-danger whitespace-pre-wrap">{err}</div>}
        <div className="flex justify-end gap-2 mt-4">
          {ws ? (
            <>
              <button className="btn-ghost" onClick={() => void api.workspaces.reveal(repo.id, prNumber)}>
                <FolderOpen className="h-3.5 w-3.5" />
                Reveal
              </button>
              {editor && (
                <button
                  className="btn"
                  onClick={() => void api.editors.open(editor.id, repo.id, undefined, prNumber)}
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Open in {editor.label}
                </button>
              )}
              <button className="btn-primary" onClick={onClose} autoFocus>
                Done
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>
                Close
              </button>
              {err && (
                <button className="btn" onClick={run} disabled={running}>
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Backdrop>
  );
}
