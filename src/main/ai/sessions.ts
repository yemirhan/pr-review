import { BrowserWindow } from 'electron';
import Store from 'electron-store';
import { AIClientError } from './client';
import { getAIConfig } from './config';
import { extractPartial, FindingNormalizer, parseReviewOutput, sortFindings } from './findings';
import { chatPR, resolveModel, reviewPR } from './provider';
import type { PriorReview, Workspace } from './prompt';
import { ensurePRWorktree, git, holdWorktree } from '../git/worktree';
import { getWorkspace } from '../git/workspaces';
import { getFilesAtRef, type FileAtRef } from '../gh/contents';
import type {
  AIReviewFinding,
  AIReviewStartOptions,
  AISession,
  AISessionSummary,
  ClickUpTask,
  FileDiff,
  GhError,
  PRDetail,
  Repo
} from '@shared/types';

/**
 * Owns every AI review and its chat. Runs live in the main process, so they
 * keep going when the panel collapses or the user opens another PR. The
 * latest session per PR is persisted; dismissals carry over to re-runs
 * because finding ids are stable.
 */

export interface PRContext {
  pr: PRDetail;
  files: FileDiff[];
  clickUpTask: ClickUpTask | null;
}

type ContextLoader = (repo: Repo, prNumber: number) => Promise<PRContext>;

const MAX_PERSISTED = 150;
const MAX_PROGRESS = 30;
/** Only the first files get fetched as context when no checkout is available. */
const FALLBACK_CONTEXT_FILES = 12;

const store = new Store<{ sessions: Record<string, AISession> }>({
  name: 'ai-sessions',
  defaults: { sessions: {} }
});

const sessions = new Map<string, AISession>();
const running = new Map<string, AbortController>();
const chatting = new Map<string, AbortController>();
let loadContext: ContextLoader | null = null;

const keyOf = (repoId: string, prNumber: number) => `${repoId}:${prNumber}`;

export function initSessions(loader: ContextLoader): void {
  loadContext = loader;
  const saved = store.get('sessions', {});
  for (const [key, s] of Object.entries(saved)) {
    // A review that was running when the app quit can't be resumed.
    const status = s.status === 'running' ? 'cancelled' : s.status;
    sessions.set(key, { ...s, status, chatStream: null, progress: [] });
  }
}

function persist(): void {
  const list = [...sessions.values()]
    .filter((s) => s.status !== 'running')
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
    .slice(0, MAX_PERSISTED);
  const out: Record<string, AISession> = {};
  for (const s of list) {
    out[keyOf(s.repoId, s.prNumber)] = { ...s, chatStream: null, progress: [] };
  }
  store.set('sessions', out);
}

// --- Broadcasting ------------------------------------------------------------

const pending = new Map<string, NodeJS.Timeout>();

function emitNow(key: string): void {
  pending.delete(key);
  const s = sessions.get(key);
  if (!s) return;
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ai:session', s);
}

/** Stream updates are coalesced; status changes go out immediately. */
function emit(key: string, immediate = false): void {
  if (immediate) {
    const t = pending.get(key);
    if (t) clearTimeout(t);
    emitNow(key);
    return;
  }
  if (!pending.has(key)) pending.set(key, setTimeout(() => emitNow(key), 120));
}

function update(key: string, fn: (s: AISession) => AISession, immediate = false): AISession | null {
  const cur = sessions.get(key);
  if (!cur) return null;
  const next = fn(cur);
  sessions.set(key, next);
  emit(key, immediate);
  return next;
}

function pushProgress(key: string, line: string): void {
  update(key, (s) => ({ ...s, progress: [...s.progress.slice(-(MAX_PROGRESS - 1)), line] }));
}

function toGhError(err: unknown): GhError {
  if (err instanceof AIClientError) return err.toJSON();
  const e = err as { code?: GhError['code']; message?: string };
  return { code: e?.code ?? 'AI_FAILED', message: e?.message ?? String(err) };
}

// --- Queries -----------------------------------------------------------------

export function getSession(repoId: string, prNumber: number): AISession | null {
  return sessions.get(keyOf(repoId, prNumber)) ?? null;
}

export function listSessions(): AISessionSummary[] {
  return [...sessions.values()].map((s) => ({
    repoId: s.repoId,
    prNumber: s.prNumber,
    headOid: s.headOid,
    status: s.status,
    findings: s.findings.filter((f) => !s.dismissed.includes(f.id)).length
  }));
}

// --- Workspace ---------------------------------------------------------------

interface Prepared {
  workspace: Workspace;
  cwd: string;
  fileContext: FileAtRef[];
}

async function prepareWorkspace(
  repo: Repo,
  pr: PRDetail,
  files: FileDiff[],
  onStatus: (line: string) => void,
  signal: AbortSignal
): Promise<Prepared> {
  // The user's own worktree for this PR works as-is when it's clean and at the head.
  const ws = getWorkspace(repo.id, pr.number);
  if (ws) {
    try {
      const head = (await git(ws.path, ['rev-parse', 'HEAD'], { signal })).trim();
      const dirty = (await git(ws.path, ['status', '--porcelain'], { signal })).trim();
      if (head === pr.headRefOid && !dirty) {
        return { workspace: { path: ws.path, headOid: pr.headRefOid }, cwd: ws.path, fileContext: [] };
      }
    } catch {
      /* fall through to the review cache */
    }
  }
  try {
    const wt = await ensurePRWorktree({
      repoId: repo.id,
      repoPath: repo.path,
      owner: repo.owner,
      name: repo.name,
      prNumber: pr.number,
      headOid: pr.headRefOid,
      onStatus,
      signal
    });
    return { workspace: { path: wt.path, headOid: pr.headRefOid }, cwd: wt.path, fileContext: [] };
  } catch (err) {
    if (signal.aborted) throw new AIClientError('AI_CANCELLED', 'Cancelled.');
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    onStatus(`Couldn't prepare a checkout (${msg}); reviewing from the diff`);
    // Fallback: full contents of the first changed files, fetched from GitHub.
    const paths = files
      .filter((f) => !f.binary && f.status !== 'removed')
      .slice(0, FALLBACK_CONTEXT_FILES)
      .map((f) => f.path);
    let fileContext: FileAtRef[] = [];
    if (paths.length > 0) {
      try {
        fileContext = await getFilesAtRef(repo.owner, repo.name, pr.headRefOid, paths);
      } catch {
        /* diff only */
      }
    }
    return { workspace: { path: null, headOid: pr.headRefOid }, cwd: repo.path, fileContext };
  }
}

// --- Review ------------------------------------------------------------------

export function startReview(repo: Repo, prNumber: number, opts: AIReviewStartOptions = {}): AISession {
  const key = keyOf(repo.id, prNumber);
  const existing = sessions.get(key);
  if (existing?.status === 'running') return existing;
  if (!loadContext) throw new Error('AI sessions not initialized');

  const cfg = getAIConfig();
  const provider = opts.provider ?? cfg.provider;
  const depth = opts.depth ?? cfg.depth;
  chatting.get(key)?.abort();

  const session: AISession = {
    repoId: repo.id,
    prNumber,
    headOid: existing?.headOid ?? '',
    provider,
    model: resolveModel(provider, depth),
    depth,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    progress: ['Loading pull request…'],
    verdict: '',
    findings: [],
    notes: [],
    dismissed: existing?.dismissed ?? [],
    error: null,
    usedWorktree: false,
    // Chat is about the PR, not one run; keep it across re-reviews.
    chat: existing?.chat ?? [],
    chatStream: null,
    threadId: null
  };
  sessions.set(key, session);
  const ac = new AbortController();
  running.set(key, ac);
  emit(key, true);

  void runReview(repo, prNumber, existing ?? null, ac).finally(() => {
    if (running.get(key) === ac) running.delete(key);
  });
  return session;
}

async function runReview(
  repo: Repo,
  prNumber: number,
  previous: AISession | null,
  ac: AbortController
): Promise<void> {
  const key = keyOf(repo.id, prNumber);
  const onStatus = (line: string) => pushProgress(key, line);
  let normalizer: FindingNormalizer | null = null;
  let text = '';
  let consumed = 0;
  let lastParse = 0;
  const release = holdWorktree(repo.id, prNumber);

  const absorb = (force = false) => {
    if (!normalizer) return;
    const now = Date.now();
    if (!force && now - lastParse < 200) return;
    lastParse = now;
    const partial = extractPartial(text);
    const fresh: AIReviewFinding[] = [];
    for (const raw of partial.findings.slice(consumed)) {
      const f = normalizer.normalize(raw);
      if (f) fresh.push(f);
    }
    consumed = partial.findings.length;
    if (fresh.length === 0 && (partial.verdict == null || partial.verdict === sessions.get(key)?.verdict)) return;
    update(key, (s) => ({
      ...s,
      verdict: partial.verdict ?? s.verdict,
      findings: [...s.findings, ...fresh]
    }));
  };

  try {
    const ctx = await loadContext!(repo, prNumber);
    if (ac.signal.aborted) throw new AIClientError('AI_CANCELLED', 'Cancelled.');
    normalizer = new FindingNormalizer(ctx.files);
    update(key, (s) => ({ ...s, headOid: ctx.pr.headRefOid }));

    const prep = await prepareWorkspace(repo, ctx.pr, ctx.files, onStatus, ac.signal);
    update(key, (s) => ({ ...s, usedWorktree: !!prep.workspace.path }));
    onStatus(
      prep.workspace.path
        ? `Reviewing ${ctx.files.length} files at ${ctx.pr.headRefOid.slice(0, 7)}`
        : `Reviewing ${ctx.files.length} files from the diff`
    );

    const prior: PriorReview | null =
      previous && (previous.status === 'done' || previous.status === 'cancelled')
        ? {
            headOid: previous.headOid,
            open: previous.findings.filter((f) => !previous.dismissed.includes(f.id)),
            dismissed: previous.findings.filter((f) => previous.dismissed.includes(f.id))
          }
        : null;

    const cur = sessions.get(key)!;
    const r = await reviewPR({
      provider: cur.provider,
      depth: cur.depth,
      pr: ctx.pr,
      files: ctx.files,
      clickUpTask: ctx.clickUpTask,
      fileContext: prep.fileContext,
      workspace: prep.workspace,
      cwd: prep.cwd,
      prior,
      signal: ac.signal,
      onStatus,
      onChunk: (chunk) => {
        text += chunk;
        absorb();
      }
    });

    const parsed = parseReviewOutput(r.text, ctx.files);
    update(
      key,
      (s) => ({
        ...s,
        status: 'done',
        finishedAt: Date.now(),
        verdict: parsed.parsed ? parsed.verdict : s.verdict,
        findings: parsed.parsed ? parsed.findings : sortFindings(s.findings),
        notes: parsed.notes,
        raw: parsed.parsed ? undefined : r.text,
        costUSD: r.costUSD,
        durationMs: r.durationMs ?? Date.now() - s.startedAt,
        threadId: r.threadId ?? null
      }),
      true
    );
  } catch (err) {
    const e = toGhError(err);
    const cancelled = e.code === 'AI_CANCELLED' || ac.signal.aborted;
    // Keep whatever streamed in before the stop.
    absorb(true);
    update(
      key,
      (s) => ({
        ...s,
        status: cancelled ? 'cancelled' : 'error',
        finishedAt: Date.now(),
        findings: sortFindings(s.findings),
        error: cancelled ? null : e
      }),
      true
    );
  } finally {
    release();
    persist();
  }
}

export function cancelReview(repoId: string, prNumber: number): void {
  const key = keyOf(repoId, prNumber);
  running.get(key)?.abort();
  chatting.get(key)?.abort();
}

export function setDismissed(repoId: string, prNumber: number, findingId: string, dismissed: boolean): AISession | null {
  const next = update(
    keyOf(repoId, prNumber),
    (s) => ({
      ...s,
      dismissed: dismissed
        ? [...new Set([...s.dismissed, findingId])]
        : s.dismissed.filter((id) => id !== findingId)
    }),
    true
  );
  persist();
  return next;
}

// --- Chat --------------------------------------------------------------------

export function sendChat(repo: Repo, prNumber: number, message: string, findingId?: string): AISession {
  const key = keyOf(repo.id, prNumber);
  const s = sessions.get(key);
  if (!s) throw new AIClientError('AI_FAILED', 'Run a review before chatting about this PR.');
  if (s.status === 'running' || s.chatStream) {
    throw new AIClientError('AI_FAILED', 'Wait for the current answer to finish.');
  }
  const ac = new AbortController();
  chatting.set(key, ac);
  const next = update(
    key,
    (cur) => ({ ...cur, chatStream: { message, text: '', status: null, findingId }, error: null }),
    true
  )!;
  void runChat(repo, prNumber, message, findingId, ac).finally(() => {
    if (chatting.get(key) === ac) chatting.delete(key);
  });
  return next;
}

async function runChat(
  repo: Repo,
  prNumber: number,
  message: string,
  findingId: string | undefined,
  ac: AbortController
): Promise<void> {
  const key = keyOf(repo.id, prNumber);
  const s = sessions.get(key)!;
  const release = holdWorktree(repo.id, prNumber);
  const setStream = (fn: (cs: NonNullable<AISession['chatStream']>) => AISession['chatStream']) =>
    update(key, (cur) => (cur.chatStream ? { ...cur, chatStream: fn(cur.chatStream) } : cur));
  try {
    const ctx = await loadContext!(repo, prNumber);
    const prep = await prepareWorkspace(
      repo,
      ctx.pr,
      ctx.files,
      (line) => setStream((cs) => ({ ...cs, status: line })),
      ac.signal
    );
    const visible = s.findings.filter((f) => !s.dismissed.includes(f.id));
    const r = await chatPR({
      provider: s.provider,
      depth: s.depth,
      pr: ctx.pr,
      files: ctx.files,
      review: { verdict: s.verdict, findings: visible, notes: s.notes },
      history: s.chat,
      message,
      focus: findingId ? (s.findings.find((f) => f.id === findingId) ?? null) : null,
      clickUpTask: ctx.clickUpTask,
      workspace: prep.workspace,
      cwd: prep.cwd,
      threadId: s.threadId,
      signal: ac.signal,
      onStatus: (line) => setStream((cs) => ({ ...cs, status: line })),
      onChunk: (chunk) => setStream((cs) => ({ ...cs, text: cs.text + chunk }))
    });
    update(
      key,
      (cur) => ({
        ...cur,
        chat: [
          ...cur.chat,
          { role: 'user', content: message, findingId },
          { role: 'assistant', content: r.text }
        ],
        chatStream: null,
        threadId: r.threadId ?? cur.threadId
      }),
      true
    );
  } catch (err) {
    const e = toGhError(err);
    const cancelled = e.code === 'AI_CANCELLED' || ac.signal.aborted;
    update(
      key,
      (cur) => {
        const partial = cur.chatStream?.text.trim() ?? '';
        const chat =
          partial || !cancelled
            ? [
                ...cur.chat,
                { role: 'user' as const, content: message, findingId },
                {
                  role: 'assistant' as const,
                  content: partial
                    ? `${partial}${cancelled ? '\n\n_(stopped)_' : ''}`
                    : `_Failed: ${e.message}_`
                }
              ]
            : cur.chat;
        return { ...cur, chat, chatStream: null };
      },
      true
    );
  } finally {
    release();
    persist();
  }
}

/** Abort everything (app quit). */
export function shutdownSessions(): void {
  for (const ac of running.values()) ac.abort();
  for (const ac of chatting.values()) ac.abort();
}
