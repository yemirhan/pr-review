import type { ReactNode } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Spinner } from './ui/spinner';
import { cn } from '../lib/cn';
import type { PRDetail } from '@shared/types';

export type MergeStatusTone = 'subtle' | 'attention' | 'danger';

export interface MergeStatus {
  /** Whether the Merge button should be enabled. */
  canMerge: boolean;
  /** Short headline for the hover popover; null when merging is clean. */
  label: string | null;
  /** Longer explanation shown in the popover body. */
  detail: string | null;
  tone: MergeStatusTone;
  /** GitHub is still computing mergeability (mergeable === null). */
  checking: boolean;
  /** The PR has conflicts — the popover links to the Conflicts tab. */
  conflicts: boolean;
}

type MergeStatusInput = Pick<
  PRDetail,
  'state' | 'isDraft' | 'mergeable' | 'mergeStateStatus' | 'baseRefName'
>;

export function getMergeStatus(pr: MergeStatusInput): MergeStatus {
  const base: MergeStatus = {
    canMerge: false,
    label: null,
    detail: null,
    tone: 'subtle',
    checking: false,
    conflicts: false
  };
  if (pr.state !== 'OPEN') return base;
  if (pr.isDraft) {
    return {
      ...base,
      label: 'Draft pull request',
      detail: "GitHub won't merge draft PRs. Mark it ready for review first."
    };
  }
  if (pr.mergeable === false) {
    return {
      ...base,
      label: 'Merge conflicts',
      detail: `This branch has conflicts with ${pr.baseRefName} that must be resolved before merging.`,
      tone: 'danger',
      conflicts: true
    };
  }
  if (pr.mergeable === null) {
    return {
      ...base,
      label: 'Checking mergeability…',
      detail:
        'GitHub recomputes mergeability after every push. This usually resolves within a minute — the app is polling and the button will enable automatically.',
      checking: true
    };
  }
  switch (pr.mergeStateStatus) {
    case 'BLOCKED':
      return {
        ...base,
        canMerge: true,
        label: 'Merge blocked',
        detail:
          'Branch protection requires approvals or passing checks before this can be merged.',
        tone: 'attention'
      };
    case 'BEHIND':
      return {
        ...base,
        canMerge: true,
        label: 'Branch is behind base',
        detail: `${pr.baseRefName} has newer commits. You may need to update the branch before merging.`,
        tone: 'attention'
      };
    case 'UNSTABLE':
      return {
        ...base,
        canMerge: true,
        label: 'Some checks failing',
        detail: 'Status checks are failing, but merging is still allowed.',
        tone: 'attention'
      };
    default:
      return { ...base, canMerge: true };
  }
}

const TONE_CLASS: Record<MergeStatusTone, string> = {
  subtle: 'text-fg-subtle',
  attention: 'text-attention',
  danger: 'text-danger'
};

/**
 * Wraps the Merge button and shows the merge-state explanation in a popover
 * on hover. Hover is handled by this wrapper because the disabled button
 * itself has pointer-events disabled.
 */
export function MergeStatusPopover({
  status,
  onShowConflicts,
  children
}: {
  status: MergeStatus;
  onShowConflicts: () => void;
  children: ReactNode;
}) {
  if (!status.label) return <>{children}</>;
  return (
    <span className="relative group inline-flex">
      {children}
      {/* pt-1.5 keeps the gap inside the hover area so the popover doesn't flicker */}
      <div className="absolute right-0 top-full z-50 hidden group-hover:block pt-1.5 w-72">
        <div className="rounded-md border border-border bg-canvas-overlay text-fg shadow-xl p-3 animate-fade-in">
          <div
            className={cn(
              'flex items-center gap-1.5 text-xs font-medium',
              TONE_CLASS[status.tone]
            )}
          >
            {status.checking ? (
              <Spinner size="xs" />
            ) : status.tone === 'subtle' ? (
              <Info className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            )}
            {status.label}
          </div>
          {status.detail && (
            <p className="mt-1.5 text-2xs text-fg-muted leading-relaxed">{status.detail}</p>
          )}
          {status.conflicts && (
            <button
              className="mt-2 text-2xs text-accent hover:underline"
              onClick={onShowConflicts}
            >
              View conflicting files →
            </button>
          )}
        </div>
      </div>
    </span>
  );
}
