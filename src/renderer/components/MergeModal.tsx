import { useState } from 'react';
import { api, unwrap, ApiError } from '../lib/api';
import type { Repo, MergeStrategy, PRDetail } from '@shared/types';

type Bypass = 'none' | 'auto' | 'admin';

/** gh's "not mergeable" message when branch protection blocks the merge. */
const POLICY_RE = /not mergeable|branch policy|prohibits the merge|--auto|--admin|protected branch|required status|review required/i;

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
  const [bypass, setBypass] = useState<Bypass>('none');
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const isProtectedBase = /^(main|master)$/i.test(pr.baseRefName);
  const blocked = pr.mergeStateStatus === 'BLOCKED';
  const needsConfirm = (isProtectedBase || bypass === 'admin') && !confirmed;
  const policyError = !!err && POLICY_RE.test(err);

  async function go() {
    if (needsConfirm) {
      setConfirmed(true);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await unwrap(
        api.review.merge(repo.id, pr.number, strategy, {
          admin: bypass === 'admin',
          auto: bypass === 'auto',
          deleteBranch
        })
      );
      onMerged();
    } catch (e) {
      setErr((e as ApiError).message);
      // Any change to the options requires re-confirming.
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }

  const label = busy
    ? bypass === 'auto'
      ? 'Enabling auto-merge…'
      : 'Merging…'
    : needsConfirm
      ? bypass === 'admin'
        ? `Confirm admin merge into ${pr.baseRefName}`
        : `Confirm merge into ${pr.baseRefName}`
      : bypass === 'auto'
        ? `Enable auto-merge (${strategy})`
        : bypass === 'admin'
          ? `Merge as admin (${strategy})`
          : `Merge (${strategy})`;

  return (
    <Backdrop onClose={onClose}>
      <div className="w-[480px] rounded-lg border border-border bg-canvas-overlay shadow-2xl p-5 animate-slide-up">
        <h2 className="text-base font-semibold mb-1">Merge PR #{pr.number}</h2>
        <p className="text-2xs text-fg-muted mb-4">
          {pr.headRefName} → {pr.baseRefName}
        </p>
        {isProtectedBase && (
          <div className="mb-4 rounded-md border border-danger-emphasis/50 bg-danger-subtle/40 px-3 py-2 text-2xs text-danger flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              You are about to merge into{' '}
              <code className="font-mono font-semibold">{pr.baseRefName}</code>. Double-check
              the strategy and the PR contents — this requires an extra confirmation.
            </span>
          </div>
        )}
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
                onChange={() => {
                  setStrategy(s);
                  setConfirmed(false);
                }}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block text-sm font-medium">{strategyLabel(s)}</span>
                <span className="block text-2xs text-fg-muted">{describe(s)}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mb-4 rounded-md border border-border-muted p-3 space-y-2">
          <div className="text-2xs uppercase tracking-wide text-fg-subtle">
            Branch protection
            {blocked && <span className="ml-2 text-attention normal-case tracking-normal">· blocked by policy</span>}
          </div>
          {(
            [
              {
                key: 'none',
                label: 'Merge normally',
                hint: 'Fails if required reviews or checks are missing.'
              },
              {
                key: 'auto',
                label: 'Enable auto-merge',
                hint: 'GitHub merges automatically once all requirements are met (`--auto`).'
              },
              {
                key: 'admin',
                label: 'Merge now with admin privileges',
                hint: 'Bypasses branch protection (`--admin`). Requires admin rights on the repo.'
              }
            ] as { key: Bypass; label: string; hint: string }[]
          ).map((o) => (
            <label key={o.key} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="bypass"
                checked={bypass === o.key}
                onChange={() => {
                  setBypass(o.key);
                  setConfirmed(false);
                }}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className={`block text-sm ${o.key === 'admin' ? 'text-danger' : 'text-fg'}`}>
                  {o.label}
                </span>
                <span className="block text-2xs text-fg-muted">{o.hint}</span>
              </span>
            </label>
          ))}
          <label className="flex items-center gap-2 pt-1 text-2xs text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
              className="accent-accent"
            />
            Delete <code className="font-mono">{pr.headRefName}</code> after merging
          </label>
        </div>

        {err && (
          <div className="mb-3 text-2xs text-danger bg-danger-subtle border border-danger-emphasis/40 rounded px-2 py-1.5 space-y-1">
            <div className="whitespace-pre-wrap">{err}</div>
            {policyError && bypass === 'none' && (
              <div className="text-fg-muted">
                Pick <span className="text-fg">Enable auto-merge</span> to merge when the
                requirements pass, or <span className="text-fg">Merge now with admin privileges</span>{' '}
                to bypass them.
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={`disabled:opacity-50 ${needsConfirm || bypass === 'admin' ? 'btn-danger' : 'btn-primary'}`}
            onClick={go}
            disabled={busy}
          >
            {label}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function strategyLabel(s: MergeStrategy): string {
  if (s === 'squash') return 'Squash and merge';
  if (s === 'merge') return 'Create a merge commit';
  return 'Rebase and merge';
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
