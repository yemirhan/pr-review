import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findEditor } from './detect';

const execFileP = promisify(execFile);

/**
 * Open a path in the chosen editor.
 *
 * Prefer the editor's CLI binary (passes the path as an argv arg, which is
 * the supported entrypoint for every editor we list). Fall back to
 * `/usr/bin/open -a "<AppName>" <path>` when the CLI isn't installed.
 */
export async function openInEditor(editorId: string, path: string): Promise<void> {
  const editor = findEditor(editorId);
  if (!editor) throw new Error(`Editor ${editorId} not found`);

  if (editor.cliPath) {
    await execFileP(editor.cliPath, [path], { timeout: 10_000 });
    return;
  }
  if (editor.appPath) {
    await execFileP('/usr/bin/open', ['-a', editor.appPath, path], {
      timeout: 10_000
    });
    return;
  }
  throw new Error(`No CLI or .app found for ${editor.label}`);
}
