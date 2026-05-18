import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

const requireFromHere = createRequire(import.meta.url);

/**
 * Electron apps launched from a `.app` bundle don't inherit the shell's PATH.
 * Extend PATH to include common Node install locations so the SDK can resolve
 * tools that aren't bundled.
 */
export function buildPathEnv(): string {
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    join(homedir(), '.local/bin'),
    join(homedir(), '.volta/bin'),
    join(homedir(), '.nvm/versions/node')
  ];
  const existing = process.env.PATH ?? '';
  return [existing, ...extra].filter(Boolean).join(delimiter);
}

/**
 * Resolve the absolute path to the SDK's bundled `cli.js`. Inside a packaged
 * Electron app this lives in `app.asar`; an external Node process cannot read
 * from inside asar, so rewrite the path to point at the unpacked mirror that
 * `asarUnpack` produces.
 */
export function resolveClaudeCodeCliPath(): string {
  const sdkEntry = requireFromHere.resolve('@anthropic-ai/claude-agent-sdk');
  const cli = join(dirname(sdkEntry), 'cli.js');
  return cli.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/**
 * Spawn the Claude Code CLI using Electron's own binary as a Node runtime
 * (via `ELECTRON_RUN_AS_NODE=1`). Avoids depending on the user having `node`
 * on their PATH — packaged apps work the same as dev.
 *
 * `opts.command` is whatever the SDK would have spawned (e.g. `node`); we
 * ignore it and use `process.execPath` instead. `opts.args` already contains
 * `[pathToClaudeCodeExecutable, ...cliArgs]`.
 */
export function spawnClaudeCode(opts: SpawnOptions): SpawnedProcess {
  const child = spawn(process.execPath, opts.args, {
    cwd: opts.cwd,
    env: {
      ...opts.env,
      ELECTRON_RUN_AS_NODE: '1'
    },
    signal: opts.signal,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  });
  // stdin/stdout are guaranteed to be Writable/Readable because we asked for
  // pipes above; the ChildProcess type marks them as nullable for the general
  // case.
  return child as unknown as SpawnedProcess;
}
