import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { api, unwrap, ApiError } from '../lib/api';
import { cn } from '../lib/cn';
import { useUI } from '../store/ui';
import type { Repo, ReviewEvent } from '@shared/types';

const EVENTS: { key: ReviewEvent; label: string; hint: string }[] = [
  { key: 'COMMENT', label: 'Comment', hint: 'General feedback without approving.' },
  { key: 'APPROVE', label: 'Approve', hint: 'Good to merge.' },
  { key: 'REQUEST_CHANGES', label: 'Request changes', hint: 'Must be addressed before merging.' }
];

/**
 * "Review" button in the PR header. Shows how many comments are drafted and
 * opens a popover to write the summary, pick the verdict and submit, like
 * GitHub's "Finish your review".
 */
export function ReviewButton({
  repo,
  prNumber,
  headOid,
  onSubmitted
}: {
  repo: Repo;
  prNumber: number;
  headOid: string;
  onSubmitted: () => void;
}) {
  const draft = useUI((s) => s.getDraft());
  const setDraftBody = useUI((s) => s.setDraftBody);
  const setDraftEvent = useUI((s) => s.setDraftEvent);
  const clearDraft = useUI((s) => s.clearDraft);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const count = draft.comments.length + draft.fileComments.length;

  // GitHub's review API rules:
  //   APPROVE          - body + inline comments both optional
  //   REQUEST_CHANGES  - body required
  //   COMMENT          - must have at least a body or an inline comment
  const bodyFilled = draft.body.trim().length > 0;
  const canSubmit =
    draft.event === 'APPROVE' ? true : draft.event === 'REQUEST_CHANGES' ? bodyFilled : bodyFilled || count > 0;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      await unwrap(api.review.submit(repo.id, prNumber, { ...draft, headOid }));
      clearDraft();
      setOpen(false);
      onSubmitted();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button className={cn('btn', open && 'bg-canvas-subtle')} onClick={() => setOpen((o) => !o)}>
        Review
        {count > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-fg-onAccent text-2xs leading-[18px] text-center tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-[420px] rounded-lg border border-border bg-canvas-overlay shadow-xl p-3 space-y-3 animate-slide-up">
          <textarea
            autoFocus
            value={draft.body}
            onChange={(e) => setDraftBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Leave a summary (optional)"
            rows={4}
            className="input w-full h-auto py-2 resize-y text-sm"
          />
          <div className="space-y-1" role="radiogroup">
            {EVENTS.map((ev) => (
              <label
                key={ev.key}
                className={cn(
                  'flex items-start gap-2.5 rounded-md px-2 py-1.5 cursor-pointer hover:bg-canvas-subtle',
                  draft.event === ev.key && 'bg-canvas-subtle'
                )}
              >
                <input
                  type="radio"
                  name="review-event"
                  className="mt-[3px] accent-accent"
                  checked={draft.event === ev.key}
                  onChange={() => setDraftEvent(ev.key)}
                />
                <span>
                  <span
                    className={cn(
                      'block text-sm',
                      ev.key === 'REQUEST_CHANGES' ? 'text-danger' : ev.key === 'APPROVE' ? 'text-success' : 'text-fg'
                    )}
                  >
                    {ev.label}
                  </span>
                  <span className="block text-2xs text-fg-subtle">{ev.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {err && <div className="text-2xs text-danger whitespace-pre-wrap">{err}</div>}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-2xs text-fg-subtle">
              {count === 0 ? 'No comments drafted' : `${count} ${count === 1 ? 'comment' : 'comments'} will be posted`}
            </span>
            <button className="btn-primary ml-auto" disabled={!canSubmit || submitting} onClick={submit}>
              {submitting ? 'Submitting…' : 'Submit review'}
            </button>
          </div>
          {draft.event === 'REQUEST_CHANGES' && !bodyFilled && (
            <div className="text-2xs text-fg-subtle -mt-1">Requesting changes needs a summary.</div>
          )}
        </div>
      )}
    </div>
  );
}
