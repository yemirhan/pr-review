import { spawn } from 'node:child_process';
import type { SystemTool, SystemToolId } from '@shared/types';
import { pathWithFallbacks } from './shellPath';

function pathEnv(): string {
  return pathWithFallbacks();
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, {
        env: { ...process.env, PATH: pathEnv() }
      });
    } catch {
      return resolve({ code: -1, stdout: '' });
    }
    let stdout = '';
    child.stdout?.on('data', (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr?.on('data', () => {});
    child.on('error', () => resolve({ code: -1, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout }));
  });
}

async function which(cmd: string): Promise<string | undefined> {
  const r = await run('/usr/bin/which', [cmd]);
  if (r.code === 0) {
    const line = r.stdout.split('\n').find((l) => l.trim().length > 0);
    return line?.trim() || undefined;
  }
  return undefined;
}

async function probe(cmd: string): Promise<{ path?: string; version?: string }> {
  const path = await which(cmd);
  if (!path) return {};
  const v = await run(path, ['--version']);
  let version: string | undefined;
  if (v.code === 0) {
    const m = v.stdout.match(/\d+\.\d+(\.\d+)?/);
    version = m ? m[0] : v.stdout.split('\n')[0]?.trim();
  }
  return { path, version };
}

interface ToolSpec {
  id: SystemToolId;
  label: string;
  bin: string;
  description: string;
  installUrl: string;
  installCommand: string;
}

const SPECS: ToolSpec[] = [
  {
    id: 'gh',
    label: 'GitHub CLI',
    bin: 'gh',
    description: 'Required to fetch PRs, post reviews, and merge from this app.',
    installUrl: 'https://cli.github.com/',
    installCommand: 'brew install gh'
  },
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    description: 'Powers AI review and chat when the Claude provider is selected.',
    installUrl: 'https://docs.claude.com/en/docs/claude-code/quickstart',
    installCommand: 'npm install -g @anthropic-ai/claude-code'
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    bin: 'codex',
    description:
      'Powers AI review and chat (via `codex app-server`) when the Codex provider is selected.',
    installUrl: 'https://github.com/openai/codex',
    installCommand: 'npm install -g @openai/codex'
  }
];

export async function detectSystemTools(): Promise<SystemTool[]> {
  const results = await Promise.all(
    SPECS.map(async (spec) => {
      const { path, version } = await probe(spec.bin);
      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        installed: !!path,
        path,
        version,
        installUrl: spec.installUrl,
        installCommand: spec.installCommand
      } satisfies SystemTool;
    })
  );
  return results;
}
