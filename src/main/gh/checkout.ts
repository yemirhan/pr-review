import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { GH_BIN } from './client';

export interface CheckoutHandlers {
  onData(channel: 'stdout' | 'stderr', data: string): void;
  onDone(exitCode: number): void;
  onError(err: Error): void;
}

/**
 * Run `gh pr checkout <num>` inside the repo directory and stream output.
 * Caller is responsible for ensuring the directory is the repo root.
 */
export function checkoutPR(
  repoPath: string,
  num: number,
  handlers: CheckoutHandlers
): { cancel: () => void } {
  if (!existsSync(repoPath)) {
    handlers.onError(new Error(`Repo path not found: ${repoPath}`));
    return { cancel: () => {} };
  }

  const child = spawn(GH_BIN, ['pr', 'checkout', String(num)], {
    cwd: repoPath,
    env: { ...process.env }
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d: string) => handlers.onData('stdout', d));
  child.stderr.on('data', (d: string) => handlers.onData('stderr', d));
  child.on('error', (e) => handlers.onError(e));
  child.on('close', (code) => handlers.onDone(code ?? -1));

  return {
    cancel: () => {
      if (!child.killed) child.kill('SIGTERM');
    }
  };
}
