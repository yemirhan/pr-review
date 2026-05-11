import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AIClientError } from '../ai/client';
import { parseUnifiedDiff } from '../diff/parse';
import type { FileDiff } from '@shared/types';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, {
    cwd,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 120_000
  });
  return stdout;
}

async function gitWithExit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 128 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => {
        const exitCode =
          err && (err as { code?: number }).code != null
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        resolve({ stdout, stderr, exitCode });
      }
    );
  });
}

export async function currentBranch(repoPath: string): Promise<string> {
  const out = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return out.trim();
}

export async function isWorkingTreeClean(repoPath: string): Promise<boolean> {
  const out = await git(repoPath, ['status', '--porcelain']);
  return out.trim().length === 0;
}

/** Untracked files relative to the repo root (no directories). */
export async function listUntracked(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, [
    'ls-files',
    '--others',
    '--exclude-standard'
  ]);
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Parse the current working-tree diff (`git diff HEAD`) into FileDiff[]. */
export async function workingDiffFiles(repoPath: string): Promise<FileDiff[]> {
  // No --color so output stays clean.
  const diff = await git(repoPath, ['diff', 'HEAD', '--no-color']);
  return parseUnifiedDiff(diff);
}

/**
 * Stage everything, commit with the given message, then push the current
 * branch to its tracking remote. No --force, no --no-verify.
 */
export async function commitAndPush(
  repoPath: string,
  message: string
): Promise<void> {
  const add = await gitWithExit(repoPath, ['add', '-A']);
  if (add.exitCode !== 0) {
    throw new AIClientError(
      'GIT_PUSH_FAILED',
      `git add failed: ${add.stderr.trim() || add.exitCode}`,
      add.stderr
    );
  }

  const commit = await gitWithExit(repoPath, ['commit', '-m', message]);
  if (commit.exitCode !== 0) {
    throw new AIClientError(
      'GIT_PUSH_FAILED',
      `git commit failed: ${commit.stderr.trim() || commit.stdout.trim() || commit.exitCode}`,
      commit.stderr || commit.stdout
    );
  }

  const push = await gitWithExit(repoPath, ['push', 'origin', 'HEAD']);
  if (push.exitCode !== 0) {
    throw new AIClientError(
      'GIT_PUSH_FAILED',
      `git push failed: ${push.stderr.trim() || push.exitCode}`,
      push.stderr
    );
  }
}

/**
 * Revert tracked-file changes and remove untracked files that Claude
 * created during the apply step. We only delete untracked paths that
 * weren't present before the apply.
 */
export async function discardWorkingChanges(
  repoPath: string,
  untrackedBefore: string[]
): Promise<void> {
  await gitWithExit(repoPath, ['restore', '--staged', '.']);
  await gitWithExit(repoPath, ['restore', '.']);

  const before = new Set(untrackedBefore);
  const nowUntracked = await listUntracked(repoPath);
  const created = nowUntracked.filter((p) => !before.has(p));
  for (const rel of created) {
    try {
      await unlink(join(repoPath, rel));
    } catch {
      /* file may have been removed by `git restore`; ignore */
    }
  }
}
