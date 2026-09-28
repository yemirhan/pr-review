import { gh } from './client';
import { invalidatePR } from './prs';
import type { ReviewDraft, DraftInlineComment, DraftFileComment } from '@shared/types';

/**
 * Submit a review with optional inline comments via REST API.
 *
 * Two-phase submission:
 *   1. POST the review (with line-level inline comments) — atomic.
 *   2. POST each file-level comment as a standalone PR review comment
 *      (the review endpoint doesn't accept subject_type=file).
 */
export async function submitReview(
  owner: string,
  name: string,
  num: number,
  draft: ReviewDraft
): Promise<void> {
  const fileComments = draft.fileComments ?? [];
  const body = (draft.body ?? '').trim();

  // A COMMENT review with neither a body nor inline comments is rejected by
  // GitHub (422). That happens when the user only left file-level comments,
  // which are posted separately in phase 2 — so skip phase 1 in that case.
  const reviewIsEmpty = draft.event === 'COMMENT' && !body && draft.comments.length === 0;
  if (reviewIsEmpty && fileComments.length === 0) {
    throw new Error('Nothing to submit: add a comment or a review body first.');
  }

  // Phase 1: the review itself.
  if (!reviewIsEmpty) {
    const payload = {
      event: draft.event,
      body,
      comments: draft.comments.map((c) => mapDraftComment(c))
    };

    await gh(
      [
        'api',
        '--method',
        'POST',
        `repos/${owner}/${name}/pulls/${num}/reviews`,
        '--input',
        '-',
        '-H',
        'Accept: application/vnd.github+json'
      ],
      { input: JSON.stringify(payload) }
    );
  }

  // Phase 2: file-level comments, one per request. Posting them after the review
  // means an early failure in phase 1 cancels the whole submission.
  try {
    if (fileComments.length === 0) return;
    if (!draft.headOid) {
      throw new Error('submitReview: headOid is required when fileComments are present');
    }
    for (const fc of fileComments) {
      await postFileComment(owner, name, num, draft.headOid, fc);
    }
  } finally {
    invalidatePR(owner, name, num);
  }
}

async function postFileComment(
  owner: string,
  name: string,
  num: number,
  commitId: string,
  c: DraftFileComment
): Promise<void> {
  const body = {
    body: c.body,
    path: c.path,
    commit_id: commitId,
    subject_type: 'file'
  };
  await gh(
    [
      'api',
      '--method',
      'POST',
      `repos/${owner}/${name}/pulls/${num}/comments`,
      '--input',
      '-',
      '-H',
      'Accept: application/vnd.github+json'
    ],
    { input: JSON.stringify(body) }
  );
}

interface InlineApiComment {
  path: string;
  body: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
}

function mapDraftComment(c: DraftInlineComment): InlineApiComment {
  const out: InlineApiComment = {
    path: c.path,
    body: c.body,
    side: c.side,
    line: c.line
  };
  if (c.startLine != null && c.startLine !== c.line) {
    out.start_line = c.startLine;
    out.start_side = c.startSide ?? c.side;
  }
  return out;
}
