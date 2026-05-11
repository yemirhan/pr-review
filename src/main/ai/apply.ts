import { query } from '@anthropic-ai/claude-agent-sdk';
import { AIClientError, getAuthStatus } from './client';
import { buildPathEnv } from './env';
import { buildApplyPrompt, extractCommitMessage, stripCommitLine } from './applyPrompt';
import {
  currentBranch,
  isWorkingTreeClean,
  listUntracked,
  workingDiffFiles
} from '../git/apply';
import type {
  AIApplyPreflight,
  AIApplyProgress,
  AIApplyResult,
  PRDetail
} from '@shared/types';

const APPLY_MODEL = 'claude-sonnet-4-6';
const APPLY_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];

export async function applyPreflight(
  repoPath: string,
  headRefName: string
): Promise<AIApplyPreflight> {
  const branch = await currentBranch(repoPath);
  const dirty = !(await isWorkingTreeClean(repoPath));
  return {
    currentBranch: branch,
    branchMatches: branch === headRefName,
    dirty
  };
}

interface ApplyParams {
  repoPath: string;
  pr: PRDetail;
  review: string;
  onProgress?: (event: AIApplyProgress) => void;
  signal?: AbortSignal;
}

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

interface TextBlock {
  type: 'text';
  text: string;
}

type ContentBlock = ToolUseBlock | TextBlock | { type: string };

function progressFromToolUse(block: ToolUseBlock): AIApplyProgress {
  const input = block.input ?? {};
  const path =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.path === 'string' && input.path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    undefined;
  return { kind: 'tool', name: block.name, path };
}

export async function applyReview({
  repoPath,
  pr,
  review,
  onProgress,
  signal
}: ApplyParams): Promise<AIApplyResult> {
  const auth = getAuthStatus();
  if (!auth.available) {
    throw new AIClientError(
      'AI_NOT_AUTHENTICATED',
      'Claude is not authenticated. Sign in via `claude` CLI or set ANTHROPIC_API_KEY.'
    );
  }

  // Snapshot untracked files before edits so a later discard can scope cleanup.
  const untrackedBefore = await listUntracked(repoPath);

  const prompt = buildApplyPrompt({ pr, review });

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort);

  let assistantText = '';

  try {
    const response = query({
      prompt,
      options: {
        model: APPLY_MODEL,
        permissionMode: 'acceptEdits',
        tools: APPLY_TOOLS,
        allowedTools: APPLY_TOOLS,
        settingSources: [],
        persistSession: false,
        cwd: repoPath,
        maxTurns: 25,
        abortController,
        env: { ...process.env, PATH: buildPathEnv() } as Record<string, string>
      }
    });

    for await (const message of response) {
      if (message.type === 'assistant') {
        if (message.error) {
          throw new AIClientError(
            'AI_FAILED',
            `Claude reported an error: ${message.error}`
          );
        }
        const blocks = (message.message.content ?? []) as ContentBlock[];
        for (const block of blocks) {
          if (block.type === 'tool_use') {
            onProgress?.(progressFromToolUse(block as ToolUseBlock));
          } else if (block.type === 'text') {
            const t = (block as TextBlock).text ?? '';
            if (t) onProgress?.({ kind: 'text', text: t });
          }
        }
        continue;
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          assistantText = message.result;
        } else {
          const detail =
            (message as { errors?: string[] }).errors?.join('; ') ?? message.subtype;
          throw new AIClientError('AI_FAILED', `Claude apply failed: ${detail}`);
        }
      }
    }
  } catch (err) {
    if (err instanceof AIClientError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AIClientError('AI_FAILED', msg);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  const commitMessage =
    extractCommitMessage(assistantText) || `AI: apply review suggestions for PR #${pr.number}`;
  const cleanText = stripCommitLine(assistantText);

  const diff = await workingDiffFiles(repoPath);

  return {
    diff,
    commitMessage,
    assistantText: cleanText,
    untrackedBefore
  };
}
