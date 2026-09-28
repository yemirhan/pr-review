import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Electron apps launched from Finder/Dock inherit a minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), so CLIs installed via Homebrew, npm,
 * volta, nvm, etc. are invisible. We ask the user's login shell for its PATH
 * once at startup and merge it into `process.env.PATH`, so every later
 * `spawn()` (gh, codex, claude, git) resolves the same binaries the user's
 * terminal would.
 */

const FALLBACK_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  join(homedir(), '.local/bin'),
  join(homedir(), '.npm-global/bin'),
  join(homedir(), '.volta/bin'),
  join(homedir(), '.claude/local'),
  join(homedir(), '.codex/bin'),
  join(homedir(), '.local/share/vite-plus/bin')
];

let loaded: Promise<string> | null = null;

function readLoginShellPath(): Promise<string> {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      // -l: login shell (reads .zprofile / .bash_profile where PATH is
      // usually set); -i: interactive (some setups only export in .zshrc).
      const child = execFile(
        shell,
        ['-ilc', 'printf "%s" "$PATH"'],
        { timeout: 4000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } },
        (err, stdout) => {
          if (err) return finish('');
          finish(String(stdout).trim());
        }
      );
      child.on('error', () => finish(''));
    } catch {
      finish('');
    }
  });
}

export function mergePaths(...lists: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const dir of list.split(delimiter)) {
      const d = dir.trim();
      if (!d || seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
  }
  return out.join(delimiter);
}

/**
 * Resolve the user's shell PATH (cached) and merge it into process.env.PATH.
 * Safe to call multiple times; only the first call does work.
 */
export function loadShellPath(): Promise<string> {
  if (!loaded) {
    loaded = (async () => {
      const shellPath = await readLoginShellPath();
      const merged = mergePaths(process.env.PATH, shellPath, FALLBACK_DIRS.join(delimiter));
      process.env.PATH = merged;
      return merged;
    })();
  }
  return loaded;
}

/** Synchronous best-effort PATH (process PATH + well-known dirs). */
export function pathWithFallbacks(): string {
  return mergePaths(process.env.PATH, FALLBACK_DIRS.join(delimiter));
}
