import type { AIReviewFinding } from './types';

/** Markdown rendering of review findings, used as the apply prompt. */
export function renderReviewMarkdown(review: {
  verdict: string;
  findings: AIReviewFinding[];
  notes: string[];
}): string {
  const parts: string[] = ['## Verdict', '', review.verdict || '(no verdict)'];
  if (review.findings.length > 0) {
    parts.push('', '## Findings');
    for (const f of review.findings) {
      const loc =
        f.line != null ? `${f.path}:${f.startLine != null ? `${f.startLine}-` : ''}${f.line}` : f.path;
      parts.push('', `### ${f.title}`, `\`${loc}\` (${f.severity})`, '', f.body);
      if (f.suggestion) parts.push('', 'Suggested replacement:', '```', f.suggestion, '```');
    }
  }
  if (review.notes.length > 0) {
    parts.push('', '## Notes', '', ...review.notes.map((n) => `- ${n}`));
  }
  return parts.join('\n');
}

/**
 * Body of the GitHub comment for a finding. Suggestion blocks only render on
 * new-side line comments, so they're added only there (the parser already
 * folds other suggestions into the body as plain code).
 */
export function findingCommentBody(f: AIReviewFinding): string {
  const body = f.body.trim();
  if (!f.suggestion || !f.anchored || f.side !== 'RIGHT') return body;
  return `${body}\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
}
