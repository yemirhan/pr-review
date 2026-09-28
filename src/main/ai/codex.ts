import {
  CodexNotInstalledError,
  CodexRpcError,
  getCodexAppServer,
  type CodexAppServer,
  type RpcNotification
} from './codex/appServer';
import { AIClientError } from './client';
import { getAIConfig } from './config';
import { buildApplyPrompt, extractCommitMessage, stripCommitLine } from './applyPrompt';
import { listUntracked, workingDiffFiles } from '../git/apply';
import type {
  AIApplyProgress,
  AIApplyResult,
  AIAuthStatus,
  AICodexModel,
  PRDetail
} from '@shared/types';

/**
 * Codex provider: drives `codex app-server` (JSON-RPC over stdio).
 *
 * - Review / chat run in a read-only sandbox with the PR diff in the prompt.
 *   Chat follow-ups reuse the same Codex thread, so history lives server-side
 *   and we only send the new message.
 * - Apply runs in a workspace-write sandbox rooted at the repo checkout, with
 *   approvals disabled (the user already opted in by clicking Apply).
 */

type ThreadMode = 'review' | 'apply';

const TURN_HARD_TIMEOUT_MS = 20 * 60_000;
const threadModes = new Map<string, ThreadMode>();
let handlersInstalled = false;

function server(): CodexAppServer {
  const s = getCodexAppServer();
  if (!handlersInstalled) {
    handlersInstalled = true;
    s.onServerRequest((method, params) => {
      const threadId = typeof params.threadId === 'string' ? params.threadId : undefined;
      const mode: ThreadMode = (threadId && threadModes.get(threadId)) || 'review';
      const allow = mode === 'apply';
      switch (method) {
        case 'item/commandExecution/requestApproval':
        case 'execCommandApproval':
        case 'item/fileChange/requestApproval':
        case 'applyPatchApproval':
          return { decision: allow ? 'accept' : 'decline' };
        case 'item/tool/requestUserInput':
          // We never have a human in the loop here; answer nothing so the
          // agent proceeds with its best judgement.
          return { answers: {} };
        case 'item/permissions/requestApproval':
          return { permissions: {}, scope: 'turn' };
        default:
          return undefined;
      }
    });
    s.on('exit', () => {
      threadModes.clear();
    });
  }
  return s;
}

/**
 * Codex often wraps the upstream API error as a JSON string inside
 * `error.message`. Unwrap it so the panel shows the actual reason, and add
 * a hint when the configured model is the problem.
 */
function humanizeCodexError(raw: string): string {
  let msg = raw.trim();
  try {
    const parsed = JSON.parse(msg) as {
      error?: { message?: string; type?: string };
      message?: string;
    };
    msg = parsed.error?.message ?? parsed.message ?? msg;
  } catch {
    /* not JSON */
  }
  if (/model/i.test(msg) && /(newer version|not found|unsupported|does not exist|invalid model)/i.test(msg)) {
    msg += ' Pick a different model in Settings → AI, or update ~/.codex/config.toml.';
  }
  return msg;
}

function toClientError(err: unknown): AIClientError {
  if (err instanceof AIClientError) return err;
  if (err instanceof CodexNotInstalledError) {
    return new AIClientError('AI_NOT_AUTHENTICATED', err.message);
  }
  if (err instanceof CodexRpcError) {
    return new AIClientError('AI_FAILED', `Codex: ${err.message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new AIClientError('AI_FAILED', `Codex: ${msg}`);
}

async function ensureServer(): Promise<CodexAppServer> {
  const s = server();
  try {
    await s.ensureStarted();
  } catch (err) {
    throw toClientError(err);
  }
  return s;
}

interface RunTurnParams {
  cwd: string;
  mode: ThreadMode;
  prompt: string;
  /** Reuse this thread if it is still alive in the current server process. */
  threadId?: string | null;
  /** JSON schema constraining the final assistant message. */
  outputSchema?: Record<string, unknown> | null;
  onDelta?: (text: string) => void;
  /** Non-message items (commands, file changes, tool calls) as they start. */
  onItem?: (item: Record<string, unknown>) => void;
  /** Interim "commentary" messages the agent emits while working. */
  onCommentary?: (text: string) => void;
  /** Reasoning effort for this turn; falls back to the configured override. */
  effort?: string | null;
  signal?: AbortSignal;
}

interface RunTurnResult {
  text: string;
  threadId: string;
  durationMs: number;
  reusedThread: boolean;
}

interface AgentMessageItem {
  type: 'agentMessage';
  id: string;
  text?: string;
  phase?: 'commentary' | 'final_answer' | null;
}

async function startThread(s: CodexAppServer, cwd: string, mode: ThreadMode): Promise<string> {
  const cfg = getAIConfig();
  const params: Record<string, unknown> = {
    cwd,
    sandbox: mode === 'apply' ? 'workspace-write' : 'read-only',
    approvalPolicy: 'never',
    ephemeral: true
  };
  if (cfg.codexModel) params.model = cfg.codexModel;
  const res = await s.request<{ thread: { id: string } }>('thread/start', params);
  const id = res.thread.id;
  s.liveThreads.add(id);
  threadModes.set(id, mode);
  return id;
}

async function runTurn(p: RunTurnParams): Promise<RunTurnResult> {
  if (p.signal?.aborted) throw new AIClientError('AI_CANCELLED', 'Cancelled.');
  const s = await ensureServer();
  const cfg = getAIConfig();

  let threadId: string;
  let reusedThread = false;
  try {
    if (p.threadId && s.liveThreads.has(p.threadId) && threadModes.get(p.threadId) === p.mode) {
      threadId = p.threadId;
      reusedThread = true;
    } else {
      threadId = await startThread(s, p.cwd, p.mode);
    }
  } catch (err) {
    throw toClientError(err);
  }

  const startedAt = Date.now();

  return new Promise<RunTurnResult>((resolve, reject) => {
    let turnId: string | null = null;
    let settled = false;
    let lastError: string | null = null;
    const phases = new Map<string, string | null>();
    const finals: string[] = [];

    const cleanup = () => {
      s.off('notification', onNotification);
      s.off('exit', onExit);
      p.signal?.removeEventListener('abort', onAbort);
      clearTimeout(hardTimer);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const fail = (err: AIClientError) => finish(() => reject(err));

    const onExit = () => {
      fail(new AIClientError('AI_FAILED', 'Codex: app-server exited mid-turn.'));
    };

    const interrupt = () => {
      if (turnId) {
        s.request('turn/interrupt', { threadId, turnId }).catch(() => {
          /* best effort */
        });
      }
    };

    const onAbort = () => {
      interrupt();
      // If Codex doesn't acknowledge the interrupt promptly, give up anyway.
      setTimeout(() => fail(new AIClientError('AI_CANCELLED', 'Cancelled.')), 5_000);
    };

    const hardTimer = setTimeout(() => {
      interrupt();
      fail(new AIClientError('AI_FAILED', 'Codex: turn timed out.'));
    }, TURN_HARD_TIMEOUT_MS);

    const onNotification = ({ method, params }: RpcNotification) => {
      if (params.threadId !== threadId) return;
      switch (method) {
        case 'turn/started': {
          const turn = params.turn as { id?: string } | undefined;
          if (turn?.id && !turnId) turnId = turn.id;
          break;
        }
        case 'item/started': {
          const item = params.item as Record<string, unknown> | undefined;
          if (!item) break;
          if (item.type === 'agentMessage') {
            const m = item as unknown as AgentMessageItem;
            phases.set(m.id, m.phase ?? null);
          } else {
            p.onItem?.(item);
          }
          break;
        }
        case 'item/agentMessage/delta': {
          const itemId = params.itemId as string;
          const delta = params.delta as string;
          if (phases.get(itemId) === 'commentary') break;
          if (delta) p.onDelta?.(delta);
          break;
        }
        case 'item/completed': {
          const item = params.item as Record<string, unknown> | undefined;
          if (item?.type === 'agentMessage') {
            const m = item as unknown as AgentMessageItem;
            const text = m.text ?? '';
            if (m.phase === 'commentary') p.onCommentary?.(text);
            else if (text) finals.push(text);
          }
          break;
        }
        case 'error': {
          const e = params.error as { message?: string } | undefined;
          if (!params.willRetry && e?.message) lastError = e.message;
          break;
        }
        case 'turn/completed': {
          const turn = params.turn as {
            id: string;
            status: string;
            error?: { message?: string } | null;
            durationMs?: number | null;
            items?: Array<Record<string, unknown>>;
          };
          if (turnId && turn.id !== turnId) break;
          const durationMs = turn.durationMs ?? Date.now() - startedAt;
          if (turn.status === 'completed') {
            let text = finals.join('\n\n').trim();
            if (!text) {
              // Fallback: pull agent messages from the turn payload.
              text = (turn.items ?? [])
                .filter((i) => i.type === 'agentMessage' && i.phase !== 'commentary')
                .map((i) => String(i.text ?? ''))
                .join('\n\n')
                .trim();
            }
            finish(() => resolve({ text, threadId, durationMs, reusedThread }));
          } else if (turn.status === 'interrupted') {
            fail(new AIClientError('AI_CANCELLED', 'Cancelled.'));
          } else {
            const detail = humanizeCodexError(turn.error?.message || lastError || turn.status);
            fail(new AIClientError('AI_FAILED', `Codex: ${detail}`));
          }
          break;
        }
        default:
          break;
      }
    };

    s.on('notification', onNotification);
    s.on('exit', onExit);
    p.signal?.addEventListener('abort', onAbort);

    const turnParams: Record<string, unknown> = {
      threadId,
      input: [{ type: 'text', text: p.prompt, text_elements: [] }]
    };
    const effort = cfg.codexReasoningEffort || p.effort;
    if (effort) turnParams.effort = effort;
    if (p.outputSchema) turnParams.outputSchema = p.outputSchema;

    s.request<{ turn: { id: string } }>('turn/start', turnParams)
      .then((res) => {
        if (!turnId) turnId = res.turn.id;
      })
      .catch((err) => fail(toClientError(err)));
  });
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const APPLY_PREAMBLE = [
  'Environment note: you are running inside a desktop PR-review app via `codex app-server`',
  'with write access to the working directory (sandboxed to it). Where the instructions',
  'below mention specific tool names (Read, Edit, Write, Glob, Grep), use your own',
  'equivalent file-reading and editing tools. Do not ask the user questions.',
  '',
  '---',
  ''
].join('\n');

/** Strip the `/bin/zsh -lc "…"` wrapper Codex puts around shell commands. */
function unwrapShell(cmd: string): string {
  const m = cmd.match(/^(?:\/\S+\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/);
  return (m ? m[2] : cmd).replace(/\s+/g, ' ').trim();
}

/** Turn a read-only shell command into a plain-language progress line. */
export function describeCommand(raw: string): string {
  const cmd = unwrapShell(raw);
  const first = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/)[0];
  const args = first.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
  const unq = (x: string) => x.replace(/^['"]|['"]$/g, '');
  const tool = args[0] ?? '';
  const operands = args.slice(1).map(unq).filter((x) => !x.startsWith('-'));
  const short = (p: string) => (p.length > 70 ? `…${p.slice(-67)}` : p);
  switch (tool) {
    case 'sed':
    case 'cat':
    case 'head':
    case 'tail':
    case 'nl':
    case 'bat': {
      const file = operands.filter((x) => !/^\d+(,\d+)?p$/.test(x)).pop();
      if (file) return `Reading ${short(file)}`;
      break;
    }
    case 'rg':
    case 'grep':
    case 'ag': {
      const [pattern, ...where] = operands;
      if (pattern) return `Searching for "${pattern.slice(0, 50)}"${where.length ? ` in ${short(where.join(' '))}` : ''}`;
      break;
    }
    case 'ls':
    case 'find':
    case 'tree':
    case 'fd':
      return `Listing ${short(operands[0] ?? '.')}`;
    case 'git':
      return `git ${operands.slice(0, 3).join(' ')}`.trim();
  }
  return `$ ${cmd.length > 90 ? `${cmd.slice(0, 87)}…` : cmd}`;
}

/** Human-readable one-liner for a tool item, shown as progress in the panel. */
function describeItem(item: Record<string, unknown>): string | null {
  switch (item.type) {
    case 'commandExecution': {
      const cmd = String(item.command ?? '').trim();
      return cmd ? describeCommand(cmd) : null;
    }
    case 'fileChange': {
      const changes = (item.changes as Array<{ path?: string }> | undefined) ?? [];
      const paths = changes.map((c) => c.path).filter(Boolean);
      return paths.length ? `Editing ${paths.join(', ')}` : 'Editing files';
    }
    case 'mcpToolCall':
      return `Tool: ${String(item.tool ?? '')}`;
    case 'webSearch':
      return 'Searching the web';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CodexCompleteParams {
  prompt: string;
  cwd: string;
  /** Continue this thread if it is still alive; otherwise a new one is started. */
  threadId?: string | null;
  outputSchema?: Record<string, unknown> | null;
  effort?: string | null;
  onChunk?: (text: string) => void;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

export interface CodexCompleteResult {
  text: string;
  threadId: string;
  durationMs: number;
  /** True when the request continued an existing thread (context already loaded). */
  reusedThread: boolean;
}

/** Is this thread alive in the current app-server process, in read-only mode? */
export async function codexThreadIsLive(threadId: string | null | undefined): Promise<boolean> {
  if (!threadId) return false;
  const s = await ensureServer();
  return s.liveThreads.has(threadId) && threadModes.get(threadId) === 'review';
}

/** One read-only completion (review or chat). */
export async function codexComplete(p: CodexCompleteParams): Promise<CodexCompleteResult> {
  const reuse = await codexThreadIsLive(p.threadId);
  const r = await runTurn({
    cwd: p.cwd,
    mode: 'review',
    prompt: p.prompt,
    threadId: reuse ? p.threadId : null,
    outputSchema: p.outputSchema ?? null,
    effort: p.effort ?? null,
    onDelta: p.onChunk,
    onItem: (item) => {
      const line = describeItem(item);
      if (line) p.onStatus?.(line);
    },
    onCommentary: (text) => {
      const line = text.trim().split('\n')[0];
      // With an output schema, Codex sometimes writes interim commentary as JSON; skip it.
      if (!line || line.startsWith('{') || line.startsWith('[')) return;
      p.onStatus?.(line.length > 160 ? `${line.slice(0, 157)}…` : line);
    },
    signal: p.signal
  });
  if (!r.text.trim()) {
    throw new AIClientError('AI_FAILED', 'Codex returned an empty response.');
  }
  return { text: r.text, threadId: r.threadId, durationMs: r.durationMs, reusedThread: r.reusedThread };
}

export interface CodexApplyParams {
  repoPath: string;
  pr: PRDetail;
  review: string;
  onProgress?: (event: AIApplyProgress) => void;
  signal?: AbortSignal;
}

function progressFromItem(item: Record<string, unknown>): AIApplyProgress[] {
  switch (item.type) {
    case 'commandExecution': {
      const cmd = String(item.command ?? '').replace(/\s+/g, ' ').trim();
      return [{ kind: 'tool', name: 'Shell', path: cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd }];
    }
    case 'fileChange': {
      const changes = (item.changes as Array<{ path?: string; kind?: string }> | undefined) ?? [];
      if (changes.length === 0) return [{ kind: 'tool', name: 'Edit' }];
      return changes.map((c) => ({
        kind: 'tool' as const,
        name: c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit',
        path: c.path
      }));
    }
    case 'mcpToolCall':
      return [{ kind: 'tool', name: String(item.tool ?? 'tool') }];
    case 'webSearch':
      return [{ kind: 'tool', name: 'WebSearch' }];
    default:
      return [];
  }
}

export async function codexApplyReview(p: CodexApplyParams): Promise<AIApplyResult> {
  const untrackedBefore = await listUntracked(p.repoPath);
  const prompt = APPLY_PREAMBLE + buildApplyPrompt({ pr: p.pr, review: p.review });
  const r = await runTurn({
    cwd: p.repoPath,
    mode: 'apply',
    prompt,
    onItem: (item) => {
      for (const ev of progressFromItem(item)) p.onProgress?.(ev);
    },
    onCommentary: (text) => {
      if (text) p.onProgress?.({ kind: 'text', text });
    },
    signal: p.signal
  });

  const commitMessage =
    extractCommitMessage(r.text) || `AI: apply review suggestions for PR #${p.pr.number}`;
  const diff = await workingDiffFiles(p.repoPath);
  return {
    diff,
    commitMessage,
    assistantText: stripCommitLine(r.text),
    untrackedBefore
  };
}

interface RawAuthStatus {
  authMethod: string | null;
  requiresOpenaiAuth: boolean | null;
}

export async function getCodexAuthStatus(): Promise<AIAuthStatus> {
  const cfg = getAIConfig();
  const modelDetail = cfg.codexModel ?? 'default model from ~/.codex/config.toml';
  try {
    const s = await ensureServer();
    const r = await s.request<RawAuthStatus>('getAuthStatus', {
      includeToken: false,
      refreshToken: false
    });
    const method = r.authMethod;
    if (method === 'chatgpt' || method === 'chatgptAuthTokens') {
      return { provider: 'codex', available: true, source: 'codex-chatgpt', detail: modelDetail };
    }
    if (method) {
      return { provider: 'codex', available: true, source: 'codex-api-key', detail: modelDetail };
    }
    if (r.requiresOpenaiAuth === false) {
      // A custom model provider handles auth itself.
      return { provider: 'codex', available: true, source: 'codex-api-key', detail: modelDetail };
    }
    return {
      provider: 'codex',
      available: false,
      source: 'none',
      detail: 'Codex is not signed in. Run `codex login` in a terminal.'
    };
  } catch (err) {
    const e = toClientError(err);
    return { provider: 'codex', available: false, source: 'none', detail: e.message };
  }
}

interface RawModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
  defaultReasoningEffort: string;
}

export async function listCodexModels(): Promise<AICodexModel[]> {
  const s = await ensureServer();
  try {
    const res = await s.request<{ data: RawModel[] }>('model/list', { limit: 100 });
    return (res.data ?? [])
      .filter((m) => !m.hidden)
      .map((m) => ({
        id: m.model || m.id,
        displayName: m.displayName || m.model || m.id,
        description: m.description ?? '',
        isDefault: !!m.isDefault,
        reasoningEfforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
        defaultReasoningEffort: m.defaultReasoningEffort
      }));
  } catch (err) {
    throw toClientError(err);
  }
}
