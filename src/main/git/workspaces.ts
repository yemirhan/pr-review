import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import Store from 'electron-store';
import { GH_BIN } from '../gh/client';
import { pathWithFallbacks } from '../system/shellPath';
import { ensureCommit, git, gitOk, inRepoQueue, isValidWorktree } from './worktree';
import type { GhError, PRDetail, PRWorkspace, PRWorkspaceStatus, Repo } from '@shared/types';

/**
 * PR workspaces: one git worktree per PR, on a real local branch, next to
 * the user's repo in `<repo>.worktrees/pr-<n>`. Several PRs of the same repo
 * can be checked out at once without touching the main checkout. Created
 * with `gh pr checkout`, so fork remotes and upstream tracking work.
 *
 * Unlike the AI review cache (worktree.ts) these belong to the user: they
 * are never evicted automatically, only removed on request, and removal
 * refuses to throw away uncommitted or unpushed work unless forced.
 */

export class WorkspaceError extends Error implements GhError {
  constructor(
    public code: GhError['code'],
    message: string,
    public stderr?: string
  ) {
    super(message);
  }
  toJSON(): GhError {
    return { code: this.code, message: this.message, stderr: this.stderr };
  }
}

const store = new Store<{ workspaces: PRWorkspace[] }>({
  name: 'workspaces',
  defaults: { workspaces: [] }
});

const keyOf = (repoId: string, prNumber: number) => `${repoId}:${prNumber}`;

function readAll(): PRWorkspace[] {
  const v = store.get('workspaces', []);
  return Array.isArray(v) ? v : [];
}

function writeAll(list: PRWorkspace[]): void {
  store.set('workspaces', list);
}

export function workspaceDir(repo: Repo, prNumber: number): string {
  return join(dirname(repo.path), `${basename(repo.path)}.worktrees`, `pr-${prNumber}`);
}

/** The PR's workspace if it's still on disk. */
export function getWorkspace(repoId: string, prNumber: number): PRWorkspace | null {
  const ws = readAll().find((w) => keyOf(w.repoId, w.prNumber) === keyOf(repoId, prNumber));
  return ws && existsSync(ws.path) ? ws : null;
}

// --- gh pr checkout ------------------------------------------------------------

function ghCheckout(
  cwd: string,
  prNumber: number,
  branch: string | null,
  onLine: (line: string) => void
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const args = ['pr', 'checkout', String(prNumber)];
    if (branch) args.push('--branch', branch);
    onLine(`$ gh ${args.join(' ')}\n`);
    let output = '';
    const child = spawn(GH_BIN, args, {
      cwd,
      env: { ...process.env, PATH: pathWithFallbacks(), GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' }
    });
    const onData = (d: Buffer) => {
      const text = d.toString('utf8');
      output += text;
      onLine(text);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, output: output + e.message }));
    child.on('close', (code) => resolve({ ok: code === 0, output }));
  });
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  return gitOk(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
}

// --- create ----------------------------------------------------------------------

export function createWorkspace(
  repo: Repo,
  pr: PRDetail,
  onLine: (line: string) => void
): Promise<PRWorkspace> {
  return inRepoQueue(repo.path, () => doCreate(repo, pr, onLine));
}

async function doCreate(repo: Repo, pr: PRDetail, onLine: (line: string) => void): Promise<PRWorkspace> {
  const existing = getWorkspace(repo.id, pr.number);
  if (existing && (await isValidWorktree(existing.path))) {
    onLine(`Worktree already exists at ${existing.path}\n`);
    return existing;
  }
  const dir = workspaceDir(repo, pr.number);
  if (existsSync(dir)) {
    if (await isValidWorktree(dir)) {
      throw new WorkspaceError('WORKSPACE_FAILED', `${dir} already exists and isn't tracked by PR Review. Remove it first.`);
    }
    throw new WorkspaceError('WORKSPACE_FAILED', `${dir} already exists. Move or delete it first.`);
  }

  await ensureCommit({
    repoPath: repo.path,
    owner: repo.owner,
    name: repo.name,
    prNumber: pr.number,
    headOid: pr.headRefOid,
    status: (l) => onLine(`${l}\n`)
  });

  onLine(`Creating worktree at ${dir}\n`);
  await mkdir(dirname(dir), { recursive: true });
  await gitOk(repo.path, ['worktree', 'prune']);
  await git(repo.path, ['worktree', 'add', '--detach', dir, pr.headRefOid]);

  // Prefer the PR's own branch name; fall back to a namespaced one when that
  // branch is checked out elsewhere (e.g. the main repo) or has diverged.
  const hadBranch = await branchExists(repo.path, pr.headRefName);
  let first = await ghCheckout(dir, pr.number, null, onLine);
  let createdBranch = !hadBranch;
  if (!first.ok) {
    let alt = `pr-${pr.number}/${pr.headRefName}`;
    if (await branchExists(repo.path, alt)) alt = `${alt}-${Date.now().toString(36)}`;
    onLine(`\nUsing local branch ${alt} instead.\n`);
    first = await ghCheckout(dir, pr.number, alt, onLine);
    createdBranch = true;
  }
  if (!first.ok) {
    await gitOk(repo.path, ['worktree', 'remove', '--force', dir]);
    throw new WorkspaceError('WORKSPACE_FAILED', 'gh pr checkout failed in the new worktree.', first.output);
  }

  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const ws: PRWorkspace = {
    repoId: repo.id,
    prNumber: pr.number,
    path: dir,
    branch,
    createdBranch,
    createdAt: Date.now()
  };
  writeAll([...readAll().filter((w) => keyOf(w.repoId, w.prNumber) !== keyOf(repo.id, pr.number)), ws]);
  onLine(`\nReady: ${dir} (${branch})\n`);
  return ws;
}

// --- status ------------------------------------------------------------------------

async function statusOf(ws: PRWorkspace): Promise<Pick<PRWorkspaceStatus, 'exists' | 'dirty' | 'unpushed'>> {
  if (!existsSync(ws.path)) return { exists: false, dirty: 0, unpushed: null };
  let dirty = 0;
  try {
    dirty = (await git(ws.path, ['status', '--porcelain'])).split('\n').filter(Boolean).length;
  } catch {
    /* treat as clean */
  }
  let unpushed: number | null = null;
  try {
    unpushed = parseInt((await git(ws.path, ['rev-list', '--count', '@{u}..HEAD'])).trim(), 10);
  } catch {
    unpushed = null;
  }
  return { exists: true, dirty, unpushed };
}

export async function listWorkspaces(
  prInfo: (repoId: string, prNumber: number) => Promise<{ state: PRWorkspaceStatus['prState']; title: string } | null>
): Promise<PRWorkspaceStatus[]> {
  const list = readAll();
  return Promise.all(
    list.map(async (ws) => {
      const [st, info] = await Promise.all([statusOf(ws), prInfo(ws.repoId, ws.prNumber).catch(() => null)]);
      return { ...ws, ...st, prState: info?.state ?? null, prTitle: info?.title ?? null };
    })
  );
}

export async function workspaceStatus(repoId: string, prNumber: number): Promise<PRWorkspaceStatus | null> {
  const ws = readAll().find((w) => keyOf(w.repoId, w.prNumber) === keyOf(repoId, prNumber));
  if (!ws) return null;
  return { ...ws, ...(await statusOf(ws)), prState: null, prTitle: null };
}

// --- remove ------------------------------------------------------------------------

/**
 * Remove a PR workspace. Without `force` it refuses when there are
 * uncommitted changes or unpushed commits. The local branch is deleted only
 * when we created it and it has nothing unpushed — commits are never lost.
 */
export function removeWorkspace(
  repo: Repo,
  prNumber: number,
  opts: { force?: boolean } = {}
): Promise<{ branchDeleted: boolean }> {
  return inRepoQueue(repo.path, async () => {
    const ws = readAll().find((w) => keyOf(w.repoId, w.prNumber) === keyOf(repo.id, prNumber));
    if (!ws) return { branchDeleted: false };
    const st = await statusOf(ws);
    if (st.exists && !opts.force && (st.dirty > 0 || (st.unpushed ?? 0) > 0)) {
      const parts = [
        st.dirty > 0 ? `${st.dirty} uncommitted change${st.dirty === 1 ? '' : 's'}` : null,
        (st.unpushed ?? 0) > 0 ? `${st.unpushed} unpushed commit${st.unpushed === 1 ? '' : 's'}` : null
      ].filter(Boolean);
      throw new WorkspaceError('WORKSPACE_DIRTY', `The worktree for #${prNumber} has ${parts.join(' and ')}.`);
    }
    if (st.exists) {
      const removed = await gitOk(repo.path, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), ws.path]);
      if (!removed) {
        throw new WorkspaceError('WORKSPACE_FAILED', `git worktree remove failed for ${ws.path}.`);
      }
    }
    await gitOk(repo.path, ['worktree', 'prune']);

    let branchDeleted = false;
    if (ws.createdBranch && st.unpushed === 0) {
      branchDeleted = await gitOk(repo.path, ['branch', '-D', ws.branch]);
    }
    writeAll(readAll().filter((w) => keyOf(w.repoId, w.prNumber) !== keyOf(repo.id, prNumber)));
    // Drop the `<repo>.worktrees` folder once its last worktree is gone.
    try {
      const parent = dirname(ws.path);
      if ((await readdir(parent)).length === 0) await rmdir(parent);
    } catch {
      /* not empty or already gone */
    }
    return { branchDeleted };
  });
}
