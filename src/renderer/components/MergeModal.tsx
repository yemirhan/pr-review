import { useState } from 'react';
import { api, unwrap, ApiError } from '../lib/api';
import type { Repo, MergeStrategy, PRDetail } from '@shared/types';

export function MergeModal({
  pr,
  repo,
  onClose,
  onMerged
}: {
  pr: PRDetail;
  repo: Repo;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [strategy, setStrategy] = useState<MergeStrategy>('squash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await unwrap(api.review.merge(repo.id, pr.number, strategy));
      onMerged();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <div className="w-[440px] rounded-lg border border-border bg-canvas-overlay shadow-2xl p-5 animate-slide-up">
        <h2 className="text-base font-semibold mb-1">Merge PR #{pr.number}</h2>
        <p className="text-2xs text-fg-muted mb-4">
          {pr.headRefName} → {pr.baseRefName}
        </p>
        <div className="space-y-2 mb-4">
          {(['squash', 'merge', 'rebase'] as MergeStrategy[]).map((s) => (
            <label
              key={s}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                strategy === s
                  ? 'border-accent bg-accent-subtle/40'
                  : 'border-border-muted hover:border-border'
              }`}
            >
              <input
                type="radio"
                name="strategy"
                value={s}
                checked={strategy === s}
                onChange={() => setStrategy(s)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium capitalize">{s} and merge</span>
                <span className="block text-2xs text-fg-muted">{describe(s)}</span>
              </span>
            </label>
          ))}
        </div>
        {err && (
          <div className="mb-3 text-2xs text-danger bg-danger-subtle border border-danger-emphasis/40 rounded px-2 py-1">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary disabled:opacity-50" onClick={go} disabled={busy}>
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function describe(s: MergeStrategy): string {
  if (s === 'squash') return 'Combine all commits into a single commit on the base branch.';
  if (s === 'merge') return 'Create a merge commit preserving all individual commits.';
  return 'Rebase the PR commits onto the base branch, no merge commit.';
}

export function Backdrop({
  children,
  onClose
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
