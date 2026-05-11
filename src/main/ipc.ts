import { dialog, ipcMain, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { GhClientError } from './gh/client';
import { listPRs, getPR, getFiles, getComments } from './gh/prs';
import { submitReview } from './gh/review';
import { mergePR } from './gh/merge';
import { checkoutPR } from './gh/checkout';
import { listRepos, addRepo, removeRepo, findRepo } from './repo/store';
import { inspectRepo } from './repo/inspect';
import { getConflicts } from './git/conflicts';
import { detectEditors } from './editors/detect';
import { openInEditor } from './editors/open';
import { AIClientError, getAuthStatus, reviewPR } from './ai/client';
import type {
  ReviewDraft,
  MergeStrategy,
  Repo,
  CheckoutProgress,
  GhError,
  AIReviewChunk
} from '@shared/types';

function toErrPayload(err: unknown): GhError {
  if (err instanceof GhClientError) return err.toJSON();
  if (err instanceof AIClientError) return err.toJSON();
  if (err instanceof Error) {
    const code = (err.message === 'NOT_A_GIT_REPO'
      ? 'NOT_A_GIT_REPO'
      : err.message === 'NOT_A_GITHUB_REMOTE'
        ? 'NOT_A_GITHUB_REMOTE'
        : 'UNKNOWN') as GhError['code'];
    return { code, message: err.message };
  }
  return { code: 'UNKNOWN', message: String(err) };
}

/** Wrap a handler so errors come back to renderer as plain { error } objects. */
function safe<TArgs extends unknown[], TRes>(fn: (...args: TArgs) => Promise<TRes>) {
  return async (...args: TArgs): Promise<{ ok: true; data: TRes } | { ok: false; error: GhError }> => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: toErrPayload(err) };
    }
  };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // Repos -----------------------------------------------------------------
  ipcMain.handle(
    'repos:list',
    safe(async () => listRepos())
  );

  ipcMain.handle(
    'repos:add',
    safe(async (): Promise<Repo | null> => {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win ?? undefined!, {
        properties: ['openDirectory'],
        title: 'Select a local git repository'
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const path = result.filePaths[0];
      if (!existsSync(`${path}/.git`)) throw new Error('NOT_A_GIT_REPO');
      const remote = await inspectRepo(path);
      return addRepo({ path, owner: remote.owner, name: remote.name });
    })
  );

  ipcMain.handle(
    'repos:remove',
    safe(async (_e, id: string) => {
      removeRepo(id);
    })
  );

  // PRs -------------------------------------------------------------------
  ipcMain.handle(
    'prs:list',
    safe(async (_e, repoId: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return listPRs(repo.owner, repo.name);
    })
  );

  ipcMain.handle(
    'prs:get',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getPR(repo.owner, repo.name, num);
    })
  );

  ipcMain.handle(
    'prs:files',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getFiles(repo.owner, repo.name, num);
    })
  );

  ipcMain.handle(
    'prs:comments',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getComments(repo.owner, repo.name, num);
    })
  );

  // Review actions --------------------------------------------------------
  ipcMain.handle(
    'review:submit',
    safe(async (_e, repoId: string, num: number, draft: ReviewDraft) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      await submitReview(repo.owner, repo.name, num, draft);
    })
  );

  ipcMain.handle(
    'review:merge',
    safe(async (_e, repoId: string, num: number, strategy: MergeStrategy) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      await mergePR(repo.owner, repo.name, num, strategy);
    })
  );

  ipcMain.handle(
    'review:checkout',
    safe(async (e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const win = BrowserWindow.fromWebContents(e.sender);
      return new Promise<{ exitCode: number }>((resolve, reject) => {
        const send = (msg: CheckoutProgress) => {
          win?.webContents.send('checkout:progress', msg);
        };
        checkoutPR(repo.path, num, {
          onData: (channel, data) => send({ channel, data }),
          onDone: (exitCode) => {
            send({ channel: 'done', data: '', exitCode });
            if (exitCode === 0) resolve({ exitCode });
            else reject(new Error(`gh pr checkout exited with code ${exitCode}`));
          },
          onError: (err) => {
            send({ channel: 'error', data: err.message });
            reject(err);
          }
        });
      });
    })
  );

  ipcMain.handle(
    'prs:conflicts',
    safe(async (_e, repoId: string, num: number, baseRefName: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getConflicts(repo.path, baseRefName, num);
    })
  );

  // Editors ---------------------------------------------------------------
  ipcMain.handle(
    'editors:list',
    safe(async () => detectEditors())
  );

  ipcMain.handle(
    'editors:open',
    safe(async (_e, editorId: string, repoId: string, relativePath?: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const target = relativePath ? `${repo.path}/${relativePath}` : repo.path;
      await openInEditor(editorId, target);
    })
  );

  // AI review -------------------------------------------------------------
  ipcMain.handle(
    'ai:auth:status',
    safe(async () => getAuthStatus())
  );

  ipcMain.handle(
    'ai:review',
    safe(async (e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const [pr, files] = await Promise.all([
        getPR(repo.owner, repo.name, num),
        getFiles(repo.owner, repo.name, num)
      ]);
      const win = BrowserWindow.fromWebContents(e.sender);
      const result = await reviewPR({
        pr,
        files,
        onChunk: (text) => {
          const chunk: AIReviewChunk = { prNumber: num, text };
          win?.webContents.send('ai:review:chunk', chunk);
        }
      });
      return result;
    })
  );

  // Misc ------------------------------------------------------------------
  ipcMain.handle(
    'shell:openExternal',
    safe(async (_e, url: string) => {
      await shell.openExternal(url);
    })
  );
}
