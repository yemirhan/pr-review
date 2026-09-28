import type { PRDetail } from '@shared/types';

interface BuildApplyPromptInput {
  pr: PRDetail;
  /** The review findings to apply, as markdown (see renderReviewMarkdown). */
  review: string;
}

export function buildApplyPrompt({ pr, review }: BuildApplyPromptInput): string {
  return [
    'You are pairing with a developer on the PR below.',
    `The working directory is a local checkout of branch \`${pr.headRefName}\` (the PR head).`,
    'Apply the findings from the AI review below to the codebase. Each finding names a file and line; where it includes a suggested replacement, prefer it.',
    '',
    '## Rules',
    '',
    '- Use the Read, Glob, and Grep tools to understand the code before editing.',
    '- Use Edit / Write to make the changes.',
    '- Apply only suggestions that have clear merit. Skip nitpicks and anything you cannot justify from the code.',
    '- Make minimal, focused changes. Do not refactor unrelated code, reformat files, or "tidy up" things the review did not call out.',
    '- Do NOT run `git`, do NOT commit, do NOT push. Just edit files.',
    '- If the review is purely informational and no code changes are warranted, make no edits and say so in your reply.',
    '',
    '## Output',
    '',
    'When you are done, finish your reply with these two parts:',
    '',
    '1. A short paragraph describing what you changed and why, or stating that no changes were needed.',
    '2. On the **very last line**, output exactly one line in the form:',
    '',
    '   `Commit message: <imperative summary, 72 chars max>`',
    '',
    'No trailing text after the commit message line.',
    '',
    '---',
    '',
    `## PR: ${pr.title}`,
    `Branch: ${pr.headRefName} → ${pr.baseRefName}`,
    `Author: @${pr.author.login}`,
    '',
    '## AI review to apply',
    '',
    review.trim()
  ].join('\n');
}

const COMMIT_LINE_RE = /^commit message:\s*(.+)$/im;

export function extractCommitMessage(text: string): string {
  const match = text.match(COMMIT_LINE_RE);
  if (match) return match[1].trim();
  return '';
}

/** Strip the trailing `Commit message: …` line so the user-facing summary is clean. */
export function stripCommitLine(text: string): string {
  return text.replace(COMMIT_LINE_RE, '').trimEnd();
}
