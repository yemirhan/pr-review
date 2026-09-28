import type {
  AIChatMessage,
  AILanguage,
  AIReviewFinding,
  ClickUpTask,
  FileDiff,
  PRDetail
} from '@shared/types';
import type { FileAtRef } from '../gh/contents';
import { OUTPUT_CONTRACT } from './findings';
import { languageHint, languageRules } from './directive';

const MAX_PATCH_LINES_PER_FILE = 800;
const MAX_TOTAL_PATCH_CHARS = 200_000;
const MAX_CONTEXT_CHARS = 200_000;

function pad(n: number | null, width: number): string {
  return (n == null ? '' : String(n)).padStart(width, ' ');
}

/**
 * Render a file's hunks with explicit old/new line numbers on every row so
 * the model can anchor findings to real lines instead of counting from the
 * hunk header (which it gets wrong constantly).
 */
function renderAnnotatedFile(f: FileDiff): string {
  const header =
    `### ${f.path} (${f.status}, +${f.additions}/-${f.deletions}` +
    (f.oldPath && f.oldPath !== f.path ? `, renamed from ${f.oldPath}` : '') +
    ')';
  if (f.binary) return `${header}\n[binary file, not shown]`;
  if (f.hunks.length === 0) return `${header}\n[no diff available]`;

  const rows: string[] = ['```', '  old   new'];
  let count = 0;
  let truncated = false;
  outer: for (const h of f.hunks) {
    rows.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      if (count >= MAX_PATCH_LINES_PER_FILE) {
        truncated = true;
        break outer;
      }
      const marker = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
      rows.push(`${pad(l.oldNo, 5)} ${pad(l.newNo, 5)} ${marker} ${l.content}`);
      count++;
    }
  }
  if (truncated) rows.push(`[... truncated after ${MAX_PATCH_LINES_PER_FILE} lines ...]`);
  rows.push('```');
  return `${header}\n${rows.join('\n')}`;
}

/** Lockfiles and generated output are noise for a reviewer. */
function isNoise(path: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|Podfile\.lock|Gemfile\.lock|composer\.lock)$/.test(path) ||
    /(^|\/)(dist|build|out|\.next|generated|__generated__)\//.test(path) ||
    /\.(snap|min\.js|map)$/.test(path);
}

/** Lower = reviewed first. Source before tests, config, locales and docs. */
function priority(f: FileDiff): number {
  const p = f.path;
  if (/(^|\/)(locales?|i18n|translations?)\//.test(p) || /\.(md|mdx|txt)$/.test(p)) return 3;
  if (/(\.|\/)(test|spec|stories)\.|__tests__\//.test(p)) return 2;
  if (/\.(json|ya?ml|toml|lock)$/.test(p)) return 2;
  return f.status === 'removed' ? 1 : 0;
}

function renderFiles(files: FileDiff[], hasWorkspace: boolean): string {
  const ordered = files
    .filter((f) => !isNoise(f.path))
    .sort((a, b) => priority(a) - priority(b) || b.additions + b.deletions - (a.additions + a.deletions));
  const rendered: string[] = [];
  const omitted: string[] = files.filter((f) => isNoise(f.path)).map((f) => f.path);
  let total = 0;
  for (const f of ordered) {
    const block = renderAnnotatedFile(f);
    if (total + block.length > MAX_TOTAL_PATCH_CHARS) {
      omitted.push(f.path);
      continue;
    }
    rendered.push(block);
    total += block.length;
  }
  if (omitted.length === 0) return rendered.join('\n\n');
  const how = hasWorkspace
    ? 'Their diff is not printed; read them in the checkout if they matter. Findings must still anchor to printed diff lines.'
    : 'Their diff is not printed.';
  return (
    rendered.join('\n\n') +
    `\n\n_Omitted (lockfiles, generated files, or size limit): ${omitted.map((x) => `\`${x}\``).join(', ')}. ${how}_`
  );
}

function renderFileContext(ctx: FileAtRef[]): string {
  if (ctx.length === 0) return '';
  const parts: string[] = [
    '## Full file contents at the PR head (context only)',
    '',
    'Use these to check surrounding code before flagging something the hunk alone cannot show. Findings must still anchor to lines printed in the diff section.'
  ];
  let total = 0;
  for (const f of ctx) {
    const block = `### ${f.path}${f.truncated ? ' (truncated)' : ''}\n\`\`\`\n${f.text}\n\`\`\``;
    if (total + block.length > MAX_CONTEXT_CHARS) {
      parts.push('', `_Context for remaining files omitted (size limit)._`);
      break;
    }
    parts.push('', block);
    total += block.length;
  }
  return parts.join('\n');
}

function renderMeta(pr: PRDetail): string {
  return [
    `Title: ${pr.title}`,
    `Author: @${pr.author.login}`,
    `Branch: ${pr.headRefName} -> ${pr.baseRefName}`,
    `Head commit: ${pr.headRefOid}`,
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

export interface Workspace {
  /** Absolute path of a read-only checkout of the PR head, or null. */
  path: string | null;
  headOid: string;
}

export interface PriorReview {
  headOid: string;
  /** Findings from the previous run that the user did not dismiss. */
  open: AIReviewFinding[];
  /** Findings the user dismissed: signals of what this team does not want. */
  dismissed: AIReviewFinding[];
}

function renderEnvironment(ws: Workspace | null): string {
  if (ws?.path) {
    return [
      '## Environment',
      '',
      `Your working directory is a read-only checkout of this pull request at its head commit \`${ws.headOid.slice(0, 12)}\`. Use it. Before you flag something, open the file and check the surrounding code; search for callers and usages when a signature, return shape or behavior changes; look for existing tests and for shared helpers the PR could have reused. Do not modify files. Do not ask questions; produce the final answer directly.`
    ].join('\n');
  }
  return [
    '## Environment',
    '',
    'You have no checkout of the repository; judge from the diff and context below only. Do not ask questions; produce the final answer directly.'
  ].join('\n');
}

function findingLine(f: AIReviewFinding): string {
  const loc = f.line != null ? `${f.path}:${f.startLine != null ? `${f.startLine}-` : ''}${f.line}` : f.path;
  return `- [${f.severity}] \`${loc}\` ${f.title}: ${f.body.replace(/\s+/g, ' ').slice(0, 400)}`;
}

function renderPrior(prior: PriorReview): string {
  const parts = [`## Previous review (at commit \`${prior.headOid.slice(0, 12)}\`)`, ''];
  if (prior.open.length > 0) {
    parts.push(
      'These findings were raised before. Re-check each one against the current code: if it still applies, report it again (keep the same title); if it was fixed, drop it.',
      '',
      ...prior.open.map(findingLine),
      ''
    );
  }
  if (prior.dismissed.length > 0) {
    parts.push(
      'The user dismissed these as unwanted. Do not raise them or close variants of them again:',
      '',
      ...prior.dismissed.map(findingLine)
    );
  }
  return parts.join('\n').trim();
}

export interface ReviewPromptInput {
  pr: PRDetail;
  files: FileDiff[];
  clickUpTask?: ClickUpTask | null;
  fileContext?: FileAtRef[];
  workspace: Workspace | null;
  prior?: PriorReview | null;
  directive: string;
  language: AILanguage;
}

function prContextSections(input: {
  pr: PRDetail;
  files: FileDiff[];
  clickUpTask?: ClickUpTask | null;
  fileContext?: FileAtRef[];
  workspace: Workspace | null;
}): string[] {
  const parts: string[] = ['## PR metadata', '', renderMeta(input.pr), '', renderDescription(input.pr)];
  if (input.clickUpTask) parts.push('', renderClickUpTask(input.clickUpTask));
  if (input.fileContext && input.fileContext.length > 0) {
    parts.push('', renderFileContext(input.fileContext));
  }
  parts.push(
    '',
    '## Diff',
    '',
    'Each line shows `old new marker content`. `+` added, `-` removed, blank = unchanged context. Files are ordered by review priority.',
    '',
    renderFiles(input.files, !!input.workspace?.path)
  );
  return parts;
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const parts = [
    input.directive.trim(),
    '',
    languageRules(input.language),
    '',
    OUTPUT_CONTRACT,
    '',
    renderEnvironment(input.workspace),
    '',
    '---',
    '',
    ...prContextSections(input)
  ];
  if (input.prior && (input.prior.open.length > 0 || input.prior.dismissed.length > 0)) {
    parts.push('', '---', '', renderPrior(input.prior));
  }
  parts.push('', '---', '', 'Now review the pull request above and respond with the JSON object only.');
  return parts.join('\n');
}

export interface ChatPromptInput {
  pr: PRDetail;
  files: FileDiff[];
  review: { verdict: string; findings: AIReviewFinding[]; notes: string[] } | null;
  history: AIChatMessage[];
  message: string;
  focus?: AIReviewFinding | null;
  clickUpTask?: ClickUpTask | null;
  workspace: Workspace | null;
  language: AILanguage;
}

function renderReview(review: NonNullable<ChatPromptInput['review']>): string {
  const parts = ['## Your review of this PR', '', `Verdict: ${review.verdict || '(none)'}`];
  if (review.findings.length > 0) parts.push('', 'Findings:', ...review.findings.map(findingLine));
  if (review.notes.length > 0) parts.push('', 'Notes:', ...review.notes.map((n) => `- ${n}`));
  return parts.join('\n');
}

function renderFocus(f: AIReviewFinding): string {
  return [
    '## The user is asking about this finding',
    '',
    findingLine(f),
    f.suggestion ? `\nSuggested replacement:\n\`\`\`\n${f.suggestion}\n\`\`\`` : '',
    '',
    'If the question is whether it is real, verify it against the code (open the file, find the callers) and say plainly if you were wrong.'
  ].join('\n');
}

const CHAT_INTRO =
  'You are an experienced senior engineer helping a developer review the pull request below. Answer the latest message directly and precisely, grounded in the code. Use GitHub-flavored markdown and reference `path:line` (new-side line numbers) when citing code. No preamble, no hedging.';

/**
 * Multi-turn chat as one prompt: PR context up top, then a transcript of
 * prior turns, then the current user message. Used when the provider has
 * no server-side thread to continue.
 */
export function buildChatPrompt(input: ChatPromptInput): string {
  const parts: string[] = [
    CHAT_INTRO,
    '',
    languageHint(input.language),
    '',
    renderEnvironment(input.workspace),
    '',
    '---',
    '',
    ...prContextSections(input)
  ];
  if (input.review) parts.push('', '---', '', renderReview(input.review));

  if (input.history.length > 0) {
    parts.push('', '---', '', '## Conversation so far', '');
    for (const m of input.history) {
      parts.push(`### ${m.role === 'user' ? 'User' : 'Assistant'}`, '', m.content.trim(), '');
    }
  }
  if (input.focus) parts.push('', '---', '', renderFocus(input.focus));
  parts.push('', '---', '', '## Current user message', '', input.message.trim(), '', 'Respond to the user message above.');
  return parts.join('\n');
}

/** Follow-up sent into an existing provider thread that already has the PR context. */
export function buildFollowUpPrompt(
  message: string,
  language: AILanguage,
  focus?: AIReviewFinding | null
): string {
  return [
    focus ? renderFocus(focus) + '\n' : '',
    '## Follow-up from the user',
    '',
    message.trim(),
    '',
    `Answer directly and precisely, grounded in the code and the conversation so far. Use GitHub-flavored markdown and reference \`path:line\` when citing code. ${languageHint(language)}`
  ].join('\n');
}
