import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Electron apps launched from a `.app` bundle don't inherit the shell's PATH.
 * The Agent SDK spawns `node` to run its bundled CLI, so we extend PATH to
 * include common locations where Node may live (Homebrew, system, volta, nvm).
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
