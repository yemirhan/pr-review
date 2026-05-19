import type {
  AIChatMessage,
  AIReviewMode,
  ClickUpTask,
  FileDiff,
  PRDetail
} from '@shared/types';

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

function renderFiles(files: FileDiff[]): string {
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
  return rendered.join('\n\n') + droppedNote;
}

function renderMeta(pr: PRDetail): string {
  return [
    `Title: ${pr.title}`,
    `Author: @${pr.author.login}`,
    `Branch: ${pr.headRefName} → ${pr.baseRefName}`,
    `Stats: +${pr.additions} / -${pr.deletions} across ${pr.changedFiles} files`
  ].join('\n');
}

function renderDescription(pr: PRDetail): string {
  return pr.body?.trim()
    ? `## PR description\n\n${pr.body.trim()}`
    : '## PR description\n\n(no description provided)';
}

export function renderClickUpTask(task: ClickUpTask): string {
  const bodyText = (task.textContent ?? task.description ?? '').trim();
  const lines: string[] = [];
  lines.push(`## Linked ClickUp task`);
  lines.push('');
  lines.push(`- **Task:** ${task.name}`);
  if (task.customId) lines.push(`- **Custom ID:** ${task.customId}`);
  lines.push(`- **Status:** ${task.status.status}`);
  lines.push(`- **List:** ${task.list.name}`);
  if (task.assignees.length > 0) {
    lines.push(`- **Assignees:** ${task.assignees.map((a) => a.username).join(', ')}`);
  }
  if (task.priority) lines.push(`- **Priority:** ${task.priority.priority}`);
  lines.push(`- **URL:** ${task.url}`);
  if (bodyText) {
    lines.push('');
    lines.push('### Task description');
    lines.push('');
    lines.push(bodyText.length > 4000 ? bodyText.slice(0, 4000) + '\n[...truncated]' : bodyText);
  }
  return lines.join('\n');
}

interface ModeSpec {
  intro: string;
  format: string;
}

const MODES: Record<AIReviewMode, ModeSpec> = {
  critique: {
    intro: 'You are an experienced software reviewer. Critically review the GitHub pull request below.',
    format: [
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
      'Be specific and grounded in the diff. Do not request changes you cannot justify from the code shown.'
    ].join('\n')
  },
  summary: {
    intro:
      'You are a senior engineer summarizing a pull request for a teammate who has not seen the code yet.',
    format: [
      'Respond in GitHub-flavored markdown with these sections:',
      '',
      '## TL;DR',
      'One or two sentences capturing the change in plain English.',
      '',
      '## What changed',
      'Bulleted list grouped by area or file. Explain WHAT changed and WHY, not a line-by-line readout.',
      '',
      '## How it works',
      'A short paragraph (2-4 sentences) describing the mechanism of the change for a reviewer skimming the PR.',
      '',
      'No critique. No suggestions. Stay descriptive and accurate.'
    ].join('\n')
  },
  recap: {
    intro:
      'You are writing a recap of what the author actually did in this PR — the kind of update they would post in a standup or release note.',
    format: [
      'Respond in GitHub-flavored markdown with these sections:',
      '',
      '## Done',
      'Bulleted list of concrete accomplishments, phrased as completed work ("Added X", "Fixed Y", "Refactored Z").',
      '',
      '## Not done / out of scope',
      'Bulleted list of things explicitly NOT in this PR but might be expected. If nothing, say so.',
      '',
      'Match the granularity of a teammate update. No code-review feedback.'
    ].join('\n')
  },
  risk: {
    intro:
      'You are assessing the risk profile of merging this pull request. Focus on what could break.',
    format: [
      'Respond in GitHub-flavored markdown with these sections:',
      '',
      '## Risk level',
      'One of: **low** / **medium** / **high**, plus one sentence of justification.',
      '',
      '## Potential failure modes',
      'Bulleted list of specific things that could break in production, ordered by likelihood. Reference `path:line` when relevant.',
      '',
      '## What to watch after deploy',
      'Bulleted list of metrics, logs, or user-facing behavior to monitor. If nothing special, say so.',
      '',
      'Be honest. Do not inflate risk to seem thorough.'
    ].join('\n')
  },
  tests: {
    intro:
      'You are a test-coverage reviewer. Evaluate what tests this PR has and what it lacks.',
    format: [
      'Respond in GitHub-flavored markdown with these sections:',
      '',
      '## Coverage in this PR',
      'Bulleted list of tests added/modified and what they cover. If none, say so.',
      '',
      '## Gaps',
      'Bulleted list of scenarios that should be tested but are not. Reference `path:line` for the code that lacks coverage.',
      '',
      '## Suggested cases',
      'Bulleted list of concrete test cases worth adding (inputs / expected outcomes). Skip if you suggested none above.',
      '',
      'Focus only on tests. No general critique.'
    ].join('\n')
  }
};

interface ReviewPromptInput {
  pr: PRDetail;
  files: FileDiff[];
  mode: AIReviewMode;
  clickUpTask?: ClickUpTask | null;
}

export function buildReviewPrompt({ pr, files, mode, clickUpTask }: ReviewPromptInput): string {
  const spec = MODES[mode] ?? MODES.critique;
  const parts: string[] = [
    spec.intro,
    '',
    spec.format,
    '',
    '---',
    '',
    '## PR metadata',
    '',
    renderMeta(pr),
    '',
    renderDescription(pr)
  ];

  if (clickUpTask) {
    parts.push('', renderClickUpTask(clickUpTask));
  }

  parts.push('', '## Changed files', '', renderFiles(files));
  return parts.join('\n');
}

interface ChatPromptInput {
  pr: PRDetail;
  files: FileDiff[];
  history: AIChatMessage[];
  message: string;
  clickUpTask?: ClickUpTask | null;
}

/**
 * Multi-turn chat is fed as one prompt: PR context up top, then a transcript
 * of prior turns, then the current user message. Claude's `query()` is
 * single-turn from our side, so we serialize history into the prompt.
 */
export function buildChatPrompt({
  pr,
  files,
  history,
  message,
  clickUpTask
}: ChatPromptInput): string {
  const parts: string[] = [
    'You are an experienced software engineer helping a developer review and discuss the pull request below. Answer the user\'s latest message directly and precisely, grounded in the diff and PR context. Use GitHub-flavored markdown. Reference `path:line` when citing the diff. Keep responses focused — no preamble.',
    '',
    '---',
    '',
    '## PR metadata',
    '',
    renderMeta(pr),
    '',
    renderDescription(pr)
  ];

  if (clickUpTask) {
    parts.push('', renderClickUpTask(clickUpTask));
  }

  parts.push('', '## Changed files', '', renderFiles(files));

  if (history.length > 0) {
    parts.push('', '---', '', '## Conversation so far', '');
    for (const m of history) {
      const label = m.role === 'user' ? 'User' : 'Assistant';
      parts.push(`### ${label}`, '', m.content.trim(), '');
    }
  }

  parts.push('', '---', '', '## Current user message', '', message.trim(), '', 'Respond to the user message above.');
  return parts.join('\n');
}
