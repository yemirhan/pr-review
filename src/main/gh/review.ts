import { gh } from './client';
import type { ReviewDraft, DraftInlineComment } from '@shared/types';

/**
 * Submit a review with optional inline comments via REST API.
 *
 * gh api uses --raw-field for string values and accepts JSON stdin via --input -.
 * For arrays of objects (comments), we POST a full JSON body on stdin.
 */
export async function submitReview(
  owner: string,
  name: string,
  num: number,
  draft: ReviewDraft
): Promise<void> {
  const payload = {
    event: draft.event,
    body: draft.body ?? '',
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
