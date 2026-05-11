import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { GhError } from '@shared/types';

/**
 * Resolve gh path. Electron apps launched from .app don't inherit shell PATH,
 * so explicitly check common Homebrew locations as a fallback.
 */
function resolveGhPath(): string {
  const candidates = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', 'gh'];
  for (const c of candidates) {
    if (c === 'gh') return c;
    if (existsSync(c)) return c;
  }
  return 'gh';
}

const GH_BIN = resolveGhPath();

const DEFAULT_TIMEOUT_MS = 30_000;
const LARGE_BUFFER = 32 * 1024 * 1024; // 32MB — diff payloads can be big

export class GhClientError extends Error implements GhError {
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

interface RawErrLike {
  code?: string | number;
  message?: string;
  stderr?: string;
  killed?: boolean;
  exitCode?: number;
}

function mapError(err: RawErrLike): GhClientError {
  const stderr = (err.stderr ?? '').trim();
  const msg = err.message ?? 'gh command failed';

  if (err.code === 'ENOENT') {
    return new GhClientError(
      'GH_NOT_INSTALLED',
      'GitHub CLI (gh) was not found. Install via `brew install gh`.'
    );
  }
  if (err.killed) {
    return new GhClientError('TIMEOUT', 'gh command timed out');
  }
  if (/not logged|authentication|gh auth login/i.test(stderr)) {
    return new GhClientError(
      'GH_NOT_AUTHENTICATED',
      'GitHub CLI is not authenticated. Run `gh auth login`.',
      stderr
    );
  }
  if (/not found|could not resolve/i.test(stderr)) {
    return new GhClientError('NOT_FOUND', stderr || msg, stderr);
  }
  return new GhClientError('UNKNOWN', stderr || msg, stderr);
}

export interface GhRunOptions {
  cwd?: string;
  timeoutMs?: number;
  input?: string;
}

/**
 * Run gh with args, returning stdout. Throws GhClientError on failure.
 *
 * Uses spawn so we can stream stdin to gh — required for `gh api --input -`
 * with JSON bodies (e.g. submitting a review with inline comments).
 */
export async function gh(args: string[], opts: GhRunOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(GH_BIN, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let aborted = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force-kill if SIGTERM isn't honored.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (d: string) => {
      stdoutBytes += Buffer.byteLength(d);
      if (stdoutBytes > LARGE_BUFFER) {
        aborted = true;
        child.kill('SIGTERM');
        return;
      }
      stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(mapError({ code: err.code, message: err.message, stderr }));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(mapError({ killed: true, message: 'gh command timed out', stderr }));
        return;
      }
      if (aborted) {
        reject(
          mapError({ message: 'gh stdout exceeded buffer limit', stderr })
        );
        return;
      }
      if (code !== 0) {
        reject(
          mapError({
            message: `gh exited with code ${code ?? '?'}`,
            stderr,
            exitCode: code ?? undefined
          })
        );
        return;
      }
      resolve(stdout);
    });

    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Run gh and parse JSON output.
 */
export async function ghJson<T>(args: string[], opts: GhRunOptions = {}): Promise<T> {
  const out = await gh(args, opts);
  try {
    return JSON.parse(out) as T;
  } catch {
    throw new GhClientError('UNKNOWN', `Failed to parse gh JSON output: ${out.slice(0, 200)}`);
  }
}

export { GH_BIN };
