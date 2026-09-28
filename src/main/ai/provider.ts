import { getAIConfig, QUICK_CLAUDE_MODEL } from './config';
import { cancelAllStreams } from './cancel';
import { claudeComplete, getAuthStatus as getClaudeAuthStatus } from './client';
import { applyReview as claudeApplyReview } from './apply';
import { codexApplyReview, codexComplete, codexThreadIsLive, getCodexAuthStatus } from './codex';
import { stopCodexAppServer } from './codex/appServer';
import { DEFAULT_DIRECTIVE } from './directive';
import { REVIEW_OUTPUT_SCHEMA } from './findings';
import {
  buildChatPrompt,
  buildFollowUpPrompt,
  buildReviewPrompt,
  type PriorReview,
  type Workspace
} from './prompt';
import type { FileAtRef } from '../gh/contents';
import type {
  AIApplyProgress,
  AIApplyResult,
  AIAuthStatus,
  AIChatMessage,
  AIProvider,
  AIReviewDepth,
  AIReviewFinding,
  ClickUpTask,
  FileDiff,
  PRDetail
} from '@shared/types';

/**
 * Builds prompts and routes them to a backend (Claude Agent SDK or Codex
 * app-server). Both run read-only in the PR checkout when one is available.
 */

export { applyPreflight } from './apply';

export function getDefaultDirective(): string {
  return DEFAULT_DIRECTIVE;
}

export async function getAuthStatus(provider?: AIProvider): Promise<AIAuthStatus> {
  const p = provider ?? getAIConfig().provider;
  if (p === 'codex') return getCodexAuthStatus();
  return getClaudeAuthStatus();
}

/** Model a review/chat will run with, for display. Null = Codex config default. */
export function resolveModel(provider: AIProvider, depth: AIReviewDepth): string | null {
  const cfg = getAIConfig();
  if (provider === 'codex') return cfg.codexModel;
  return depth === 'quick' ? QUICK_CLAUDE_MODEL : cfg.claudeModel;
}

interface CompleteArgs {
  provider: AIProvider;
  depth: AIReviewDepth;
  prompt: string;
  cwd: string;
  /** True when `cwd` is a checkout of the PR head the model may explore. */
  explore: boolean;
  threadId?: string | null;
  outputSchema?: Record<string, unknown> | null;
  onChunk?: (text: string) => void;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

interface Completed {
  text: string;
  threadId?: string;
  costUSD?: number;
  durationMs?: number;
}

async function complete(a: CompleteArgs): Promise<Completed> {
  if (a.provider === 'codex') {
    const r = await codexComplete({
      prompt: a.prompt,
      cwd: a.cwd,
      threadId: a.threadId,
      outputSchema: a.outputSchema,
      effort: a.depth === 'quick' ? 'low' : 'high',
      onChunk: a.onChunk,
      onStatus: a.onStatus,
      signal: a.signal
    });
    return { text: r.text, threadId: r.threadId, durationMs: r.durationMs };
  }
  const r = await claudeComplete({
    prompt: a.prompt,
    model: resolveModel('claude', a.depth) ?? undefined,
    cwd: a.explore ? a.cwd : null,
    maxTurns: a.depth === 'quick' ? 15 : 50,
    outputSchema: a.outputSchema,
    onChunk: a.onChunk,
    onStatus: a.onStatus,
    signal: a.signal
  });
  return { text: r.text, costUSD: r.costUSD, durationMs: r.durationMs };
}

export interface ReviewParams {
  provider: AIProvider;
  depth: AIReviewDepth;
  pr: PRDetail;
  files: FileDiff[];
  clickUpTask?: ClickUpTask | null;
  fileContext?: FileAtRef[];
  workspace: Workspace | null;
  /** Directory the provider runs in (checkout if available, else the user's repo). */
  cwd: string;
  prior?: PriorReview | null;
  onChunk?: (text: string) => void;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

/** Runs the review; returns the raw JSON text for the caller to parse. */
export async function reviewPR(p: ReviewParams): Promise<Completed> {
  const cfg = getAIConfig();
  const prompt = buildReviewPrompt({
    pr: p.pr,
    files: p.files,
    clickUpTask: p.clickUpTask,
    fileContext: p.fileContext,
    workspace: p.workspace,
    prior: p.prior,
    directive: cfg.directive ?? DEFAULT_DIRECTIVE,
    language: cfg.language
  });
  return complete({
    provider: p.provider,
    depth: p.depth,
    prompt,
    cwd: p.cwd,
    explore: !!p.workspace?.path,
    outputSchema: REVIEW_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    onChunk: p.onChunk,
    onStatus: p.onStatus,
    signal: p.signal
  });
}

export interface ChatParams {
  provider: AIProvider;
  depth: AIReviewDepth;
  pr: PRDetail;
  files: FileDiff[];
  review: { verdict: string; findings: AIReviewFinding[]; notes: string[] } | null;
  history: AIChatMessage[];
  message: string;
  focus?: AIReviewFinding | null;
  clickUpTask?: ClickUpTask | null;
  workspace: Workspace | null;
  cwd: string;
  threadId?: string | null;
  onChunk?: (text: string) => void;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

export async function chatPR(p: ChatParams): Promise<Completed> {
  const cfg = getAIConfig();
  const continueThread = p.provider === 'codex' && (await codexThreadIsLive(p.threadId));
  const prompt = continueThread
    ? buildFollowUpPrompt(p.message, cfg.language, p.focus)
    : buildChatPrompt({
        pr: p.pr,
        files: p.files,
        review: p.review,
        history: p.history,
        message: p.message,
        focus: p.focus,
        clickUpTask: p.clickUpTask,
        workspace: p.workspace,
        language: cfg.language
      });
  return complete({
    provider: p.provider,
    depth: p.depth,
    prompt,
    cwd: p.cwd,
    explore: !!p.workspace?.path,
    threadId: continueThread ? p.threadId : null,
    onChunk: p.onChunk,
    onStatus: p.onStatus,
    signal: p.signal
  });
}

export interface ApplyParams {
  provider: AIProvider;
  repoPath: string;
  pr: PRDetail;
  review: string;
  onProgress?: (event: AIApplyProgress) => void;
  signal?: AbortSignal;
}

export async function applyReview(p: ApplyParams): Promise<AIApplyResult> {
  if (p.provider === 'codex') return codexApplyReview(p);
  return claudeApplyReview(p);
}

/** Abort in-flight streams and stop background processes (app quit). */
export function shutdownAI(): void {
  cancelAllStreams();
  stopCodexAppServer();
}
