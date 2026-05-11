import { useEffect, useRef, useState } from 'react';
import { Backdrop } from './MergeModal';
import { api } from '../lib/api';
import type { Repo } from '@shared/types';

export function CheckoutModal({
  repo,
  prNumber,
  onClose,
  onSuccess
}: {
  repo: Repo;
  prNumber: number;
  onClose: () => void;
  /** Fired when the checkout exits with code 0. Used to hand off back to callers. */
  onSuccess?: () => void;
}) {
  const [lines, setLines] = useState<{ channel: string; data: string }[]>([]);
  const [done, setDone] = useState<{ code: number } | null>(null);
  const [running, setRunning] = useState(false);
  const consoleRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight });
  }, [lines]);

  async function run() {
    setLines([]);
    setDone(null);
    setRunning(true);
    const off = api.events.onCheckoutProgress((msg) => {
      if (msg.channel === 'done') {
        setDone({ code: msg.exitCode ?? -1 });
      } else if (msg.channel === 'error') {
        setLines((l) => [...l, { channel: 'stderr', data: msg.data }]);
      } else {
        setLines((l) => [...l, { channel: msg.channel, data: msg.data }]);
      }
    });
    try {
      await api.review.checkout(repo.id, prNumber);
    } finally {
      setRunning(false);
      off();
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="w-[640px] rounded-lg border border-border bg-canvas-overlay shadow-2xl p-5 animate-slide-up">
        <h2 className="text-base font-semibold mb-1">Checkout PR #{prNumber}</h2>
        <p className="text-2xs text-fg-muted mb-3">
          Runs <code className="text-fg">gh pr checkout {prNumber}</code> in{' '}
          <code className="text-fg">{repo.path}</code>
        </p>
        <pre
          ref={consoleRef}
          className="h-56 overflow-auto rounded-md bg-canvas-inset border border-border-muted p-3 text-2xs font-mono text-fg whitespace-pre-wrap"
        >
          {lines.length === 0 && (
            <span className="text-fg-subtle">Click “Run” to start.</span>
          )}
          {lines.map((l, i) => (
            <span key={i} className={l.channel === 'stderr' ? 'text-attention' : ''}>
              {l.data}
            </span>
          ))}
          {done && (
            <span
              className={done.code === 0 ? 'text-success' : 'text-danger'}
            >{`\n[exit ${done.code}]`}</span>
          )}
        </pre>
        <div className="flex justify-end gap-2 mt-3">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          {done?.code === 0 ? (
            <button
              className="btn-primary"
              onClick={() => {
                onSuccess?.();
                onClose();
              }}
              autoFocus
            >
              Done
            </button>
          ) : (
            <button
              className="btn-primary disabled:opacity-50"
              onClick={run}
              disabled={running}
            >
              {running ? 'Running…' : done ? 'Run again' : 'Run'}
            </button>
          )}
        </div>
      </div>
    </Backdrop>
  );
}
