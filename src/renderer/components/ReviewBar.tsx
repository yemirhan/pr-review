import { useState } from 'react';
import { api, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import type { Repo, ReviewEvent } from '@shared/types';

export function ReviewBar({
  repo,
  prNumber,
  onSubmitted
}: {
  repo: Repo;
  prNumber: number;
  onSubmitted: () => void;
}) {
  const draft = useUI((s) => s.getDraft());
  const setDraftBody = useUI((s) => s.setDraftBody);
  const setDraftEvent = useUI((s) => s.setDraftEvent);
  const clearDraft = useUI((s) => s.clearDraft);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // GitHub's review API rules:
  //   APPROVE          - body + inline comments both optional
  //   REQUEST_CHANGES  - body required
  //   COMMENT          - must have at least a body or an inline comment
  const bodyFilled = draft.body.trim().length > 0;
  const hasInline = draft.comments.length > 0;
  const canSubmit =
    draft.event === 'APPROVE'
      ? true
      : draft.event === 'REQUEST_CHANGES'
        ? bodyFilled
        : bodyFilled || hasInline;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await unwrap(api.review.submit(repo.id, prNumber, draft));
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
    <div className="border-t border-border-muted bg-canvas-inset/60 px-3 py-2">
      {open && (
        <div className="mb-2 animate-slide-up">
          <textarea
            value={draft.body}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Overall review comment (optional)…"
            rows={3}
            className="w-full bg-canvas-inset border border-border rounded-md p-2 text-sm text-fg outline-none focus:border-accent resize-y"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-2xs text-fg-muted">
          <span className="chip">{draft.comments.length} inline draft{draft.comments.length === 1 ? '' : 's'}</span>
          {draft.body.trim().length > 0 && <span className="chip">Body added</span>}
          {!open && (
            <button onClick={() => setOpen(true)} className="btn-ghost">
              + Add overall comment
            </button>
          )}
          {open && (
            <button onClick={() => setOpen(false)} className="btn-ghost">
              Hide
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-2xs text-danger">{err}</span>}
          <EventPicker value={draft.event} onChange={setDraftEvent} />
          <button
            className={
              draft.event === 'REQUEST_CHANGES'
                ? 'btn-danger disabled:opacity-50'
                : draft.event === 'APPROVE'
                  ? 'btn-primary disabled:opacity-50'
                  : 'btn disabled:opacity-50'
            }
            disabled={!canSubmit || submitting}
            onClick={submit}
          >
            {submitting ? 'Submitting…' : labelFor(draft.event)}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventPicker({
  value,
  onChange
}: {
  value: ReviewEvent;
  onChange: (e: ReviewEvent) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ReviewEvent)}
      className="input text-sm cursor-pointer"
    >
      <option value="COMMENT">Comment</option>
      <option value="APPROVE">Approve</option>
      <option value="REQUEST_CHANGES">Request changes</option>
    </select>
  );
}

function labelFor(e: ReviewEvent): string {
  if (e === 'APPROVE') return 'Approve';
  if (e === 'REQUEST_CHANGES') return 'Request changes';
  return 'Submit review';
}
