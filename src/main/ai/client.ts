import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildPathEnv, resolveClaudeCodeCliPath, spawnClaudeCode } from './env';
import { DEFAULT_CLAUDE_MODEL, getAIConfig } from './config';
import type { AIAuthStatus, GhError } from '@shared/types';

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
    return { provider: 'claude', available: true, source: 'api-key', detail: getAIConfig().claudeModel };
  }
  const claudeDir = join(homedir(), '.claude');
  if (existsSync(claudeDir)) {
    return { provider: 'claude', available: true, source: 'claude-code', detail: getAIConfig().claudeModel };
  }
  return {
    provider: 'claude',
    available: false,
    source: 'none',
    detail: 'Sign in with the `claude` CLI or set ANTHROPIC_API_KEY.'
  };
}

export interface CompleteParams {
  prompt: string;
  model?: string;
  /**
   * Directory the agent may read (a checkout of the PR head). When set, the
   * agent gets read-only Read/Grep/Glob confined to it; otherwise it answers
   * from the prompt alone.
   */
  cwd?: string | null;
  maxTurns?: number;
  /** JSON schema for the final answer (structured output). */
  outputSchema?: Record<string, unknown> | null;
  /** Answer text (or structured-output JSON) as it streams. */
  onChunk?: (text: string) => void;
  /** Progress lines: tool calls such as file reads and searches. */
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  costUSD?: number;
  durationMs?: number;
}

interface StreamEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string };
}

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];

function describeTool(name: string, input: Record<string, unknown>, cwd: string): string | null {
  const rel = (p: unknown) => {
    const s = typeof p === 'string' ? p : '';
    return s.startsWith(cwd) ? s.slice(cwd.length).replace(/^\/+/, '') || '.' : s;
  };
  switch (name) {
    case 'Read':
      return `Reading ${rel(input.file_path)}`;
    case 'Grep':
      return `Searching for "${String(input.pattern ?? '')}"${input.path ? ` in ${rel(input.path)}` : ''}`;
    case 'Glob':
      return `Listing ${String(input.pattern ?? '')}`;
    default:
      return null;
  }
}

function isInside(root: string, p: unknown): boolean {
  if (typeof p !== 'string' || !p) return true;
  const abs = resolve(root, p);
  return abs === root || abs.startsWith(root + sep);
}

/**
 * One completion through the Claude Agent SDK. With `cwd` the agent can
 * explore the PR checkout read-only before answering; the answer (or the
 * structured output) streams through `onChunk`.
 */
export async function claudeComplete(p: CompleteParams): Promise<CompleteResult> {
  const auth = getAuthStatus();
  if (!auth.available) {
    throw new AIClientError(
      'AI_NOT_AUTHENTICATED',
      'Claude is not authenticated. Sign in via `claude` CLI or set ANTHROPIC_API_KEY.'
    );
  }

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  p.signal?.addEventListener('abort', onAbort);
  const root = p.cwd ? resolve(p.cwd) : null;

  try {
    const response = query({
      prompt: p.prompt,
      options: {
        model: p.model ?? DEFAULT_CLAUDE_MODEL,
        cwd: root ?? undefined,
        tools: root ? READ_ONLY_TOOLS : [],
        // Every tool call goes through canUseTool, which confines reads to the checkout.
        permissionMode: 'default',
        canUseTool: async (toolName, input) => {
          if (!root || !READ_ONLY_TOOLS.includes(toolName)) {
            return { behavior: 'deny', message: 'Only read-only tools inside the PR checkout are allowed.' };
          }
          if (!isInside(root, input.file_path) || !isInside(root, input.path)) {
            return { behavior: 'deny', message: 'Stay inside the PR checkout.' };
          }
          return { behavior: 'allow', updatedInput: input };
        },
        settingSources: [],
        persistSession: false,
        includePartialMessages: true,
        maxTurns: root ? (p.maxTurns ?? 40) : 1,
        outputFormat: p.outputSchema ? { type: 'json_schema', schema: p.outputSchema } : undefined,
        abortController,
        env: { ...process.env, PATH: buildPathEnv() } as Record<string, string>,
        pathToClaudeCodeExecutable: resolveClaudeCodeCliPath(),
        spawnClaudeCodeProcess: spawnClaudeCode
      }
    });

    let finalText = '';
    let costUSD: number | undefined;
    let durationMs: number | undefined;
    // Stream text of the current turn; structured output arrives as the
    // input JSON of a tool block, which we forward the same way.
    let streamingBlock: 'text' | 'json' | null = null;

    for await (const message of response) {
      if (message.type === 'stream_event') {
        const e = message.event as StreamEvent;
        if (e.type === 'message_start') {
          // A new turn; only the last turn's text is the answer.
          streamingBlock = null;
        } else if (e.type === 'content_block_start') {
          const b = e.content_block;
          if (b?.type === 'text') streamingBlock = 'text';
          else if (b?.type === 'tool_use' && b.name && !READ_ONLY_TOOLS.includes(b.name)) streamingBlock = 'json';
          else streamingBlock = null;
        } else if (e.type === 'content_block_delta') {
          if (streamingBlock === 'text' && e.delta?.type === 'text_delta' && e.delta.text) {
            p.onChunk?.(e.delta.text);
          } else if (streamingBlock === 'json' && e.delta?.type === 'input_json_delta' && e.delta.partial_json) {
            p.onChunk?.(e.delta.partial_json);
          }
        }
        continue;
      }
      if (message.type === 'assistant') {
        if (message.error) {
          throw new AIClientError('AI_FAILED', `Claude reported an error: ${message.error}`);
        }
        if (root) {
          for (const block of message.message.content) {
            if (block.type === 'tool_use') {
              const line = describeTool(block.name, (block.input ?? {}) as Record<string, unknown>, root);
              if (line) p.onStatus?.(line);
            }
          }
        }
        continue;
      }
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          finalText =
            message.structured_output !== undefined && message.structured_output !== null
              ? JSON.stringify(message.structured_output)
              : message.result;
          costUSD = message.total_cost_usd;
          durationMs = message.duration_ms;
        } else {
          const detail = (message as { errors?: string[] }).errors?.join('; ') ?? message.subtype;
          throw new AIClientError('AI_FAILED', `Claude request failed: ${detail}`);
        }
      }
    }

    if (!finalText.trim()) {
      throw new AIClientError('AI_FAILED', 'Claude returned an empty response.');
    }
    return { text: finalText, costUSD, durationMs };
  } catch (err) {
    if (err instanceof AIClientError) throw err;
    if (p.signal?.aborted) throw new AIClientError('AI_CANCELLED', 'Cancelled.');
    const msg = err instanceof Error ? err.message : String(err);
    throw new AIClientError('AI_FAILED', msg);
  } finally {
    p.signal?.removeEventListener('abort', onAbort);
  }
}
