import { existsSync } from 'node:fs';
import type { Editor } from '@shared/types';

interface EditorSpec {
  id: string;
  label: string;
  cliCandidates: string[];
  appCandidates: string[];
}

const SPECS: EditorSpec[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    cliCandidates: ['/opt/homebrew/bin/cursor', '/usr/local/bin/cursor'],
    appCandidates: ['/Applications/Cursor.app']
  },
  {
    id: 'vscode',
    label: 'VS Code',
    cliCandidates: ['/opt/homebrew/bin/code', '/usr/local/bin/code'],
    appCandidates: ['/Applications/Visual Studio Code.app']
  },
  {
    id: 'zed',
    label: 'Zed',
    cliCandidates: ['/opt/homebrew/bin/zed', '/usr/local/bin/zed'],
    appCandidates: ['/Applications/Zed.app', '/Applications/Zed Preview.app']
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    cliCandidates: ['/opt/homebrew/bin/subl', '/usr/local/bin/subl'],
    appCandidates: ['/Applications/Sublime Text.app']
  },
  {
    id: 'webstorm',
    label: 'WebStorm',
    cliCandidates: ['/opt/homebrew/bin/webstorm', '/usr/local/bin/webstorm'],
    appCandidates: ['/Applications/WebStorm.app']
  }
];

export function detectEditors(): Editor[] {
  const out: Editor[] = [];
  for (const spec of SPECS) {
    const cli = spec.cliCandidates.find((p) => existsSync(p));
    const app = spec.appCandidates.find((p) => existsSync(p));
    if (cli || app) {
      out.push({ id: spec.id, label: spec.label, cliPath: cli, appPath: app });
    }
  }
  return out;
}

export function findEditor(id: string): Editor | undefined {
  return detectEditors().find((e) => e.id === id);
}
