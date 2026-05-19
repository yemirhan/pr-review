import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildPathEnv, resolveClaudeCodeCliPath, spawnClaudeCode } from './env';
import { buildChatPrompt, buildReviewPrompt } from './prompt';
import type {
  AIAuthStatus,
  AIChatMessage,
  AIChatResult,
  AIReviewMode,
  AIReviewResult,
  ClickUpTask,
  FileDiff,
  GhError,
  PRDetail
} from '@shared/types';

const REVIEW_MODEL = 'claude-sonnet-4-6';

export class AIClientError extends Error implements GhError {
  code: GhError['code'];
  stderr?: string;
  constructor(code: GhError['code'], message: string, stderr?: string) {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
  toJSON(): GhError {
    return { code: this.code, message: this.message, stderr: this.stderr };
  }
}

/**
 * The Claude Agent SDK reads `ANTHROPIC_API_KEY` when set, otherwise falls
 * back to the local Claude Code credentials stored under `~/.claude/`. We
 * surface which source (if any) is configured so the UI can give a clear
 * message before the user clicks "Run AI Review".
 */
export function getAuthStatus(): AIAuthStatus {
  if (process.env.ANTHROPIC_API_KEY) {
    return { available: true, source: 'api-key' };
  }
  const claudeDir = join(homedir(), '.claude');
  if (existsSync(claudeDir)) {
    return { available: true, source: 'claude-code' };
  }
  return { available: false, source: 'none' };
}

interface ReviewParams {
  pr: PRDetail;
  files: FileDiff[];
  mode: AIReviewMode;
  clickUpTask?: ClickUpTask | null;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}

interface ChatParams {
  pr: PRDetail;
  files: FileDiff[];
  history: AIChatMessage[];
  message: string;
  clickUpTask?: ClickUpTask | null;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}

interface StreamDelta {
  type?: string;
  delta?: { type?: string; text?: string };
}

function extractDeltaText(event: unknown): string {
  const e = event as StreamDelta;
  if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
    return e.delta.text ?? '';
  }
  return '';
}

export async function reviewPR({
  pr,
  files,
  mode,
  clickUpTask,
  onChunk,
  signal
}: ReviewParams): Promise<AIReviewResult> {
  const auth = getAuthStatus();
  if (!auth.available) {
    throw new AIClientError(
      'AI_NOT_AUTHENTICATED',
      'Claude is not authenticated. Sign in via `claude` CLI or set ANTHROPIC_API_KEY.'
    );
  }

  const prompt = buildReviewPrompt({ pr, files, mode, clickUpTask });

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = query({
      prompt,
      options: {
        model: REVIEW_MODEL,
        permissionMode: 'plan',
        tools: [],
        allowedTools: [],
        settingSources: [],
        persistSession: false,
        includePartialMessages: true,
        maxTurns: 1,
        abortController,
        env: { ...process.env, PATH: buildPathEnv() } as Record<string, string>,
        pathToClaudeCodeExecutable: resolveClaudeCodeCliPath(),
        spawnClaudeCodeProcess: spawnClaudeCode
      }
    });

    let finalText = '';
    let costUSD: number | undefined;
    let durationMs: number | undefined;

    for await (const message of response) {
      if (message.type === 'stream_event') {
        const delta = extractDeltaText(message.event);
        if (delta && onChunk) onChunk(delta);
        continue;
      }
      if (message.type === 'assistant' && message.error) {
        throw new AIClientError(
          'AI_FAILED',
          `Claude reported an error: ${message.error}`
        );
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          finalText = message.result;
          costUSD = message.total_cost_usd;
          durationMs = message.duration_ms;
        } else {
          const detail = (message as { errors?: string[] }).errors?.join('; ') ?? message.subtype;
          throw new AIClientError('AI_FAILED', `Claude review failed: ${detail}`);
        }
      }
    }

    if (!finalText.trim()) {
      throw new AIClientError('AI_FAILED', 'Claude returned an empty review.');
    }

    return { summary: finalText, mode, costUSD, durationMs };
  } catch (err) {
    if (err instanceof AIClientError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AIClientError('AI_FAILED', msg);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function chatPR({
  pr,
  files,
  history,
  message,
  clickUpTask,
  onChunk,
  signal
}: ChatParams): Promise<AIChatResult> {
  const auth = getAuthStatus();
  if (!auth.available) {
    throw new AIClientError(
      'AI_NOT_AUTHENTICATED',
      'Claude is not authenticated. Sign in via `claude` CLI or set ANTHROPIC_API_KEY.'
    );
  }

  const prompt = buildChatPrompt({ pr, files, history, message, clickUpTask });

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = query({
      prompt,
      options: {
        model: REVIEW_MODEL,
        permissionMode: 'plan',
        tools: [],
        allowedTools: [],
        settingSources: [],
        persistSession: false,
        includePartialMessages: true,
        maxTurns: 1,
        abortController,
        env: { ...process.env, PATH: buildPathEnv() } as Record<string, string>,
        pathToClaudeCodeExecutable: resolveClaudeCodeCliPath(),
        spawnClaudeCodeProcess: spawnClaudeCode
      }
    });

    let finalText = '';
    let costUSD: number | undefined;
    let durationMs: number | undefined;

    for await (const msg of response) {
      if (msg.type === 'stream_event') {
        const delta = extractDeltaText(msg.event);
        if (delta && onChunk) onChunk(delta);
        continue;
      }
      if (msg.type === 'assistant' && msg.error) {
        throw new AIClientError('AI_FAILED', `Claude reported an error: ${msg.error}`);
      }
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          finalText = msg.result;
          costUSD = msg.total_cost_usd;
          durationMs = msg.duration_ms;
        } else {
          const detail = (msg as { errors?: string[] }).errors?.join('; ') ?? msg.subtype;
          throw new AIClientError('AI_FAILED', `Claude chat failed: ${detail}`);
        }
      }
    }

    if (!finalText.trim()) {
      throw new AIClientError('AI_FAILED', 'Claude returned an empty reply.');
    }

    return { reply: finalText, costUSD, durationMs };
  } catch (err) {
    if (err instanceof AIClientError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new AIClientError('AI_FAILED', msg);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
