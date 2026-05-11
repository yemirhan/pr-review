import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConflictInfo, ConflictFile } from '@shared/types';

const execFileP = promisify(execFile);

const CONFLICT_PREVIEW_LIMIT = 256 * 1024; // 256 KB per file

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000
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
      { cwd, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 },
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

/**
 * Compute conflicting files between the PR head and its base.
 *
 * Uses `git merge-tree --write-tree` (git ≥ 2.38). Fetches the head ref
 * into a namespaced ref so we don't trample the user's local branches.
 */
export async function getConflicts(
  repoPath: string,
  baseRefName: string,
  prNumber: number
): Promise<ConflictInfo> {
  const headRef = `refs/pr-review/head-${prNumber}`;
  const baseRef = `refs/pr-review/base-${prNumber}`;

  try {
    await git(repoPath, ['fetch', 'origin', `${baseRefName}:${baseRef}`, '--force']);
    await git(repoPath, [
      'fetch',
      'origin',
      `pull/${prNumber}/head:${headRef}`,
      '--force'
    ]);
  } catch (e) {
    return { conflicting: false, files: [], error: (e as Error).message };
  }

  const res = await gitWithExit(repoPath, [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '--no-messages',
    baseRef,
    headRef
  ]);

  if (res.exitCode === 0) {
    // Clean merge — no conflicts.
    return { conflicting: false, files: [] };
  }
  if (res.exitCode !== 1) {
    return {
      conflicting: false,
      files: [],
      error: res.stderr.trim() || `git merge-tree exited ${res.exitCode}`
    };
  }

  const lines = res.stdout.split('\n').filter(Boolean);
  if (lines.length < 1) {
    return { conflicting: true, files: [] };
  }
  const treeOid = lines[0];
  const paths = lines.slice(1);

  const files: ConflictFile[] = [];
  for (const path of paths) {
    try {
      const content = await git(repoPath, ['show', `${treeOid}:${path}`]);
      const truncated = content.length > CONFLICT_PREVIEW_LIMIT;
      files.push({
        path,
        content: truncated ? content.slice(0, CONFLICT_PREVIEW_LIMIT) : content,
        truncated
      });
    } catch (e) {
      files.push({
        path,
        content: `(failed to read merged blob: ${(e as Error).message})`,
        truncated: false
      });
    }
  }

  return { conflicting: true, files };
}
