import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { GhError } from '@shared/types';

/**
 * Resolve gh path. Electron apps launched from .app don't inherit shell PATH,
 * so explicitly check common Homebrew locations as a fallback. When none of
 * the well-known paths exist we fall back to bare `gh`, which resolves via
 * process.env.PATH at spawn time (see system/shellPath.ts).
 */
function resolveGhPath(): string {
  const candidates = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'gh';
}

const GH_BIN = resolveGhPath();

const DEFAULT_TIMEOUT_MS = 45_000;
const LARGE_BUFFER = 32 * 1024 * 1024; // 32MB — diff payloads can be big

/**
 * GitHub's *secondary* rate limits are triggered by request bursts, not by
 * the hourly quota — the app used to fire a dozen `gh` processes at once
 * (one per repo in the sidebar, plus detail/files/comments/checks for the
 * open PR) and got HTTP 429 back. We therefore cap concurrency and, when a
 * 429 does slip through, pause every call for a cooldown window instead of
 * hammering the API further.
 */
const MAX_CONCURRENT = 3;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const RATE_LIMIT_RE = /rate limit|HTTP 429|\b429\b|abuse detection|secondary limit/i;

let active = 0;
const waiters: Array<() => void> = [];
let cooldownUntil = 0;

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

export function rateLimitRemainingMs(): number {
  return Math.max(0, cooldownUntil - Date.now());
}

export class GhClientError extends Error implements GhError {
  code: GhError['code'];
  stderr?: string;
  retryAfterMs?: number;
  constructor(code: GhError['code'], message: string, stderr?: string, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.stderr = stderr;
    this.retryAfterMs = retryAfterMs;
  }
  toJSON(): GhError {
    return {
      code: this.code,
      message: this.message,
      stderr: this.stderr,
      retryAfterMs: this.retryAfterMs
    };
  }
}

interface RawErrLike {
  code?: string | number;
  message?: string;
  stderr?: string;
  killed?: boolean;
  exitCode?: number;
}

function rateLimitedError(stderr: string): GhClientError {
  cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  const secs = Math.round(RATE_LIMIT_COOLDOWN_MS / 1000);
  return new GhClientError(
    'RATE_LIMITED',
    `GitHub rate limit hit. Requests are paused for ${secs}s and will resume automatically.`,
    stderr,
    RATE_LIMIT_COOLDOWN_MS
  );
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
    return new GhClientError('TIMEOUT', 'gh command timed out', stderr);
  }
  if (RATE_LIMIT_RE.test(stderr)) {
    return rateLimitedError(stderr);
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

function runGh(args: string[], opts: GhRunOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(GH_BIN, args, {
      cwd: opts.cwd,
      // Disable gh's interactive prompts — we're never attached to a TTY.
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let aborted = false;
    let timedOut = false;

    const isRunning = () => child.exitCode === null && child.signalCode === null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Force-kill if SIGTERM isn't honored. (`child.killed` only records
      // that kill() was called, so check exit/signal codes instead.)
      setTimeout(() => {
        if (isRunning()) child.kill('SIGKILL');
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
        reject(mapError({ message: 'gh stdout exceeded buffer limit', stderr }));
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

    child.stdin.on('error', () => {
      /* gh may exit before reading stdin; ignore EPIPE */
    });
    if (opts.input !== undefined) {
      child.stdin.end(opts.input);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Run gh with args, returning stdout. Throws GhClientError on failure.
 *
 * Uses spawn so we can stream stdin to gh — required for `gh api --input -`
 * with JSON bodies (e.g. submitting a review with inline comments).
 *
 * Calls are funnelled through a small concurrency gate, and refused outright
 * (with RATE_LIMITED + retryAfterMs) while a rate-limit cooldown is active.
 */
export async function gh(args: string[], opts: GhRunOptions = {}): Promise<string> {
  const remaining = rateLimitRemainingMs();
  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    throw new GhClientError(
      'RATE_LIMITED',
      `GitHub rate limit cooldown: retrying in ${secs}s.`,
      undefined,
      remaining
    );
  }
  await acquire();
  try {
    return await runGh(args, opts);
  } finally {
    release();
  }
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
