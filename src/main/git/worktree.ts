import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import Store from 'electron-store';
import { parseGitHubUrl } from '../repo/inspect';
import { pathWithFallbacks } from '../system/shellPath';

/**
 * Read-only-ish checkouts of a PR head for AI reviewers, kept outside the
 * user's working tree under `<userData>/worktrees/<repoId>/pr-<n>`.
 *
 * The head commit is fetched into the user's repo under a private ref
 * namespace (`refs/pr-review/pr-<n>`) so no user branches are created and
 * the commit isn't garbage-collected while the worktree exists.
 */

export interface PRWorktree {
  path: string;
  headOid: string;
  reused: boolean;
}

export interface EnsurePRWorktreeOptions {
  repoId: string;
  repoPath: string;
  owner: string;
  name: string;
  prNumber: number;
  headOid: string;
  onStatus?: (line: string) => void;
  signal?: AbortSignal;
}

interface WorktreeEntry {
  key: string;
  repoPath: string;
  path: string;
  lastUsed: number;
}

const MAX_WORKTREES = 10;
const DEFAULT_TIMEOUT = 120_000;
const FETCH_TIMEOUT = 5 * 60_000;

const store = new Store<{ entries: WorktreeEntry[] }>({
  name: 'worktrees',
  defaults: { entries: [] }
});

/** In-flight ensure calls per key, so concurrent reviews of one PR don't race. */
const inflight = new Map<string, Promise<PRWorktree>>();
/** Worktrees an agent is currently reading; never evicted. Counted, since review and chat can overlap. */
const inUse = new Map<string, number>();

export function holdWorktree(repoId: string, prNumber: number): () => void {
  const key = `${repoId}:${prNumber}`;
  inUse.set(key, (inUse.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (inUse.get(key) ?? 1) - 1;
    if (n <= 0) inUse.delete(key);
    else inUse.set(key, n);
  };
}

// ---------------------------------------------------------------------------
// git helpers

class GitError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null
  ) {
    super(message);
    this.name = 'GitError';
  }
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function git(
  cwd: string,
  args: string[],
  opts: { timeout?: number; signal?: AbortSignal } = {}
): Promise<string> {
  throwIfAborted(opts.signal);
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        timeout: opts.timeout ?? DEFAULT_TIMEOUT,
        signal: opts.signal,
        env: {
          ...process.env,
          PATH: pathWithFallbacks(),
          // Never block on a credential prompt nobody can answer.
          GIT_TERMINAL_PROMPT: '0'
        }
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        if (opts.signal?.aborted || err.name === 'AbortError') return reject(abortError());
        const code = (err as { code?: unknown }).code;
        reject(
          new GitError(
            `git ${args[0]} failed: ${String(stderr).trim() || err.message}`,
            String(stderr),
            typeof code === 'number' ? code : null
          )
        );
      }
    );
  });
}

export async function gitOk(cwd: string, args: string[], signal?: AbortSignal): Promise<boolean> {
  try {
    await git(cwd, args, { signal });
    return true;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return false;
  }
}

// ---------------------------------------------------------------------------
// public API

export function worktreeDir(repoId: string, prNumber: number): string {
  return join(app.getPath('userData'), 'worktrees', repoId, `pr-${prNumber}`);
}

function keyOf(repoId: string, prNumber: number): string {
  return `${repoId}:${prNumber}`;
}

function privateRef(prNumber: number): string {
  return `refs/pr-review/pr-${prNumber}`;
}

/** Tail of the per-repo queue: fetch / worktree add share one .git, so they run one at a time. */
const repoQueues = new Map<string, Promise<unknown>>();

/** Run `fn` after every earlier queued git job for this repo has settled. */
export function inRepoQueue<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = repoQueues.get(repoPath) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  repoQueues.set(repoPath, run);
  const cleanup = () => {
    if (repoQueues.get(repoPath) === run) repoQueues.delete(repoPath);
  };
  run.then(cleanup, cleanup);
  return run;
}

export function ensurePRWorktree(opts: EnsurePRWorktreeOptions): Promise<PRWorktree> {
  const key = keyOf(opts.repoId, opts.prNumber);
  const run = inRepoQueue(opts.repoPath, () => doEnsure(opts));
  inflight.set(key, run);
  const cleanup = () => {
    if (inflight.get(key) === run) inflight.delete(key);
  };
  run.then(cleanup, cleanup);
  return run;
}

/**
 * Make sure a PR's head commit is in the repo's object store, fetching it
 * into the private `refs/pr-review/pr-<n>` ref when needed.
 */
export async function ensureCommit(opts: {
  repoPath: string;
  owner: string;
  name: string;
  prNumber: number;
  headOid: string;
  status?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { repoPath, owner, name, prNumber, headOid, signal } = opts;
  if (await hasCommit(repoPath, headOid, signal)) return;
  opts.status?.(`Fetching PR #${prNumber} head…`);
  const remote = await findRemote(repoPath, owner, name, signal);
  try {
    await git(repoPath, ['fetch', '--no-tags', remote, `+refs/pull/${prNumber}/head:${privateRef(prNumber)}`], {
      timeout: FETCH_TIMEOUT,
      signal
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
  }
  if (await hasCommit(repoPath, headOid, signal)) return;
  // PR ref moved on (force-push) or pull refs unavailable — fetch the oid directly.
  await git(repoPath, ['fetch', '--no-tags', remote, headOid], { timeout: FETCH_TIMEOUT, signal });
  if (!(await hasCommit(repoPath, headOid, signal))) {
    throw new Error(`Commit ${headOid.slice(0, 7)} for PR #${prNumber} could not be fetched`);
  }
  // Pin it so GC doesn't drop it while a worktree uses it.
  await gitOk(repoPath, ['update-ref', privateRef(prNumber), headOid], signal);
}

/** AI-review cache checkouts (not user workspaces). */
export function listReviewCache(): { key: string; path: string; lastUsed: number; inUse: boolean }[] {
  return readEntries()
    .filter((e) => existsSync(e.path))
    .map((e) => ({ key: e.key, path: e.path, lastUsed: e.lastUsed, inUse: inUse.has(e.key) || inflight.has(e.key) }));
}

/** Remove every review-cache checkout that no agent is using. Returns how many were removed. */
export async function clearReviewCache(): Promise<number> {
  let removed = 0;
  for (const e of readEntries()) {
    if (inUse.has(e.key) || inflight.has(e.key)) continue;
    try {
      await inRepoQueue(e.repoPath, () => removeWorktreeDir(e.repoPath, e.path));
      removed++;
    } catch {
      /* best effort */
    }
    writeEntries(readEntries().filter((x) => x.key !== e.key));
  }
  return removed;
}

async function doEnsure(opts: EnsurePRWorktreeOptions): Promise<PRWorktree> {
  const { repoId, repoPath, owner, name, prNumber, headOid, onStatus, signal } = opts;
  const status = (line: string) => {
    try {
      onStatus?.(line);
    } catch {
      /* ignore listener errors */
    }
  };
  const dir = worktreeDir(repoId, prNumber);
  const short = headOid.slice(0, 7);

  // 1. Make sure the head commit exists in the user's object store.
  await ensureCommit({ repoPath, owner, name, prNumber, headOid, status, signal });

  // 2. Create or refresh the worktree.
  status(`Preparing worktree at ${short}…`);
  let reused = existsSync(dir);
  if (reused && !(await isValidWorktree(dir, signal))) {
    await rm(dir, { recursive: true, force: true });
    reused = false;
  }

  if (reused) {
    await git(dir, ['checkout', '--detach', '--force', headOid], { signal });
    await git(dir, ['reset', '--hard', '-q', headOid], { signal });
  } else {
    await gitOk(repoPath, ['worktree', 'prune'], signal);
    await mkdir(dirname(dir), { recursive: true });
    await git(repoPath, ['worktree', 'add', '--detach', '--force', dir, headOid], { signal });
  }

  // 3. LRU bookkeeping — never fail the caller on pruning problems.
  touchEntry({ key: keyOf(repoId, prNumber), repoPath, path: dir, lastUsed: Date.now() });
  try {
    await pruneWorktrees();
  } catch {
    /* ignore */
  }

  return { path: dir, headOid, reused };
}

export async function removePRWorktree(
  repoId: string,
  prNumber: number,
  repoPath: string
): Promise<void> {
  const key = keyOf(repoId, prNumber);
  const pending = inflight.get(key);
  if (pending) await pending.catch(() => undefined);
  const entry = readEntries().find((e) => e.key === key);
  await removeWorktreeDir(repoPath, entry?.path ?? worktreeDir(repoId, prNumber));
  await gitOk(repoPath, ['update-ref', '-d', privateRef(prNumber)]);
  writeEntries(readEntries().filter((e) => e.key !== key));
}

/** Keep the MAX_WORKTREES most recently used worktrees; remove the rest. */
export async function pruneWorktrees(): Promise<void> {
  const entries = readEntries().sort((a, b) => b.lastUsed - a.lastUsed);
  const evict = entries.slice(MAX_WORKTREES).filter((e) => !inflight.has(e.key) && !inUse.has(e.key));
  for (const e of evict) {
    try {
      await removeWorktreeDir(e.repoPath, e.path);
      const prNumber = Number(e.key.slice(e.key.lastIndexOf(':') + 1));
      if (Number.isFinite(prNumber) && existsSync(e.repoPath)) {
        await gitOk(e.repoPath, ['update-ref', '-d', privateRef(prNumber)]);
      }
    } catch {
      /* best effort */
    }
    writeEntries(readEntries().filter((x) => x.key !== e.key));
  }
}

// ---------------------------------------------------------------------------
// internals

async function hasCommit(repoPath: string, oid: string, signal?: AbortSignal): Promise<boolean> {
  return gitOk(repoPath, ['cat-file', '-e', `${oid}^{commit}`], signal);
}

export async function findRemote(
  repoPath: string,
  owner: string,
  name: string,
  signal?: AbortSignal
): Promise<string> {
  try {
    const out = await git(repoPath, ['remote', '-v'], { signal });
    const want = `${owner}/${name}`.toLowerCase();
    for (const line of out.split('\n')) {
      const [remote, url] = line.trim().split(/\s+/);
      if (!remote || !url) continue;
      const parsed = parseGitHubUrl(url);
      if (parsed && `${parsed.owner}/${parsed.name}`.toLowerCase() === want) return remote;
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
  }
  return 'origin';
}

export async function isValidWorktree(dir: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const inside = (await git(dir, ['rev-parse', '--is-inside-work-tree'], { signal })).trim();
    if (inside !== 'true') return false;
    // Guard against `dir` being some stray folder inside another checkout.
    const top = (await git(dir, ['rev-parse', '--show-toplevel'], { signal })).trim();
    return realpathSync(top) === realpathSync(dir);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return false;
  }
}

async function removeWorktreeDir(repoPath: string, path: string): Promise<void> {
  const repoExists = existsSync(repoPath);
  if (repoExists && (await gitOk(repoPath, ['worktree', 'remove', '--force', path]))) return;
  await rm(path, { recursive: true, force: true });
  if (repoExists) await gitOk(repoPath, ['worktree', 'prune']);
}

function readEntries(): WorktreeEntry[] {
  const v = store.get('entries', []);
  return Array.isArray(v) ? v : [];
}

function writeEntries(entries: WorktreeEntry[]): void {
  store.set('entries', entries);
}

function touchEntry(entry: WorktreeEntry): void {
  writeEntries([...readEntries().filter((e) => e.key !== entry.key), entry]);
}
