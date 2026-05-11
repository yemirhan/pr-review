import type { FileDiff, PRDetail } from '@shared/types';

const MAX_PATCH_LINES_PER_FILE = 800;
const MAX_TOTAL_PATCH_CHARS = 180_000;

function truncatePatch(patch: string): { text: string; truncated: boolean } {
  const lines = patch.split('\n');
  if (lines.length <= MAX_PATCH_LINES_PER_FILE) {
    return { text: patch, truncated: false };
  }
  const head = lines.slice(0, MAX_PATCH_LINES_PER_FILE).join('\n');
  return { text: head, truncated: true };
}

function renderFile(f: FileDiff): string {
  const header =
    `### ${f.path} (${f.status}, +${f.additions}/-${f.deletions}` +
    (f.oldPath && f.oldPath !== f.path ? `, renamed from ${f.oldPath}` : '') +
    `)`;
  if (f.binary) return `${header}\n[binary file — not shown]`;
  if (!f.patch) return `${header}\n[no diff available]`;
  const { text, truncated } = truncatePatch(f.patch);
  const suffix = truncated ? `\n[...truncated to ${MAX_PATCH_LINES_PER_FILE} lines...]` : '';
  return `${header}\n\`\`\`diff\n${text}${suffix}\n\`\`\``;
}

export function buildReviewPrompt(pr: PRDetail, files: FileDiff[]): string {
  const meta = [
    `Title: ${pr.title}`,
    `Author: @${pr.author.login}`,
    `Branch: ${pr.headRefName} → ${pr.baseRefName}`,
    `Stats: +${pr.additions} / -${pr.deletions} across ${pr.changedFiles} files`
  ].join('\n');

  const description = pr.body?.trim()
    ? `## PR description\n\n${pr.body.trim()}`
    : '## PR description\n\n(no description provided)';

  const rendered: string[] = [];
  let totalChars = 0;
  let droppedFiles = 0;
  for (const f of files) {
    const block = renderFile(f);
    if (totalChars + block.length > MAX_TOTAL_PATCH_CHARS) {
      droppedFiles = files.length - rendered.length;
      break;
    }
    rendered.push(block);
    totalChars += block.length;
  }
  const droppedNote =
    droppedFiles > 0
      ? `\n\n_Note: ${droppedFiles} additional file(s) omitted to keep the prompt within size limits._`
      : '';

  return [
    'You are an experienced software reviewer. Review the GitHub pull request below.',
    '',
    'Respond in GitHub-flavored markdown with exactly these three sections:',
    '',
    '## Overview',
    'A short paragraph (2-4 sentences) describing what this PR does and the change in shape.',
    '',
    '## Concerns',
    'Bulleted list of correctness, security, performance, or design concerns. Reference `path:line` when relevant. If nothing meaningful is wrong, write a single bullet saying so — do not invent issues.',
    '',
    '## Suggestions',
    'Bulleted list of concrete suggestions or follow-ups. Skip nitpicks. If you have none, say so explicitly.',
    '',
    'Be specific and grounded in the diff. Do not request changes you cannot justify from the code shown.',
    '',
    '---',
    '',
    '## PR metadata',
    '',
    meta,
    '',
    description,
    '',
    '## Changed files',
    '',
    rendered.join('\n\n') + droppedNote
  ].join('\n');
}
