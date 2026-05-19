import { dialog, ipcMain, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { GhClientError } from './gh/client';
import { listPRs, getPR, getFiles, getComments } from './gh/prs';
import { submitReview } from './gh/review';
import { editPRTitle } from './gh/edit';
import { mergePR } from './gh/merge';
import { checkoutPR } from './gh/checkout';
import { listRepos, addRepo, removeRepo, findRepo } from './repo/store';
import { inspectRepo } from './repo/inspect';
import { getConflicts } from './git/conflicts';
import { detectEditors } from './editors/detect';
import { openInEditor } from './editors/open';
import { AIClientError, getAuthStatus, reviewPR } from './ai/client';
import { applyPreflight, applyReview } from './ai/apply';
import { commitAndPush, discardWorkingChanges } from './git/apply';
import {
  ClickUpClientError,
  getList,
  getTask,
  getTaskComments,
  getTeams,
  whoami
} from './integrations/clickup/client';
import {
  getApiToken,
  getConfig as getClickUpConfig,
  getRepoConfig as getClickUpRepoConfig,
  getTeamId,
  setApiToken,
  setRepoConfig as setClickUpRepoConfig,
  setTeamId,
  setTeams
} from './integrations/clickup/config';
import { parseTaskIdFromBranch } from './integrations/clickup/branch';
import type {
  ReviewDraft,
  MergeStrategy,
  Repo,
  CheckoutProgress,
  GhError,
  AIReviewChunk,
  AIApplyProgress,
  ClickUpConfig,
  ClickUpRepoConfig,
  ClickUpLookupResult,
  PRListState
} from '@shared/types';

function toErrPayload(err: unknown): GhError {
  if (err instanceof GhClientError) return err.toJSON();
  if (err instanceof AIClientError) return err.toJSON();
  if (err instanceof ClickUpClientError) return err.toJSON();
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
    safe(async (_e, repoId: string, state?: PRListState) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const s = state ?? 'open';
      const limit = s === 'open' ? 100 : 50;
      return listPRs(repo.owner, repo.name, s, limit);
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
    'prs:editTitle',
    safe(async (_e, repoId: string, num: number, title: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const trimmed = title.trim();
      if (!trimmed) throw new Error('Title cannot be empty');
      await editPRTitle(repo.owner, repo.name, num, trimmed);
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

  ipcMain.handle(
    'ai:apply:preflight',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const pr = await getPR(repo.owner, repo.name, num);
      return applyPreflight(repo.path, pr.headRefName);
    })
  );

  ipcMain.handle(
    'ai:apply',
    safe(async (e, repoId: string, num: number, review: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const pr = await getPR(repo.owner, repo.name, num);
      const pre = await applyPreflight(repo.path, pr.headRefName);
      if (!pre.branchMatches) {
        throw new AIClientError(
          'AI_WRONG_BRANCH',
          `Repo is on branch "${pre.currentBranch}", but the PR head is "${pr.headRefName}". Check out the PR first.`
        );
      }
      if (pre.dirty) {
        throw new AIClientError(
          'AI_WORKING_TREE_DIRTY',
          'Working tree has uncommitted changes. Commit or stash them before applying AI changes.'
        );
      }
      const win = BrowserWindow.fromWebContents(e.sender);
      return applyReview({
        repoPath: repo.path,
        pr,
        review,
        onProgress: (event: AIApplyProgress) => {
          win?.webContents.send('ai:apply:progress', event);
        }
      });
    })
  );

  ipcMain.handle(
    'ai:apply:push',
    safe(async (_e, repoId: string, message: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const trimmed = message.trim();
      if (!trimmed) throw new Error('Commit message cannot be empty');
      await commitAndPush(repo.path, trimmed);
    })
  );

  ipcMain.handle(
    'ai:apply:discard',
    safe(async (_e, repoId: string, untrackedBefore: string[]) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      await discardWorkingChanges(repo.path, untrackedBefore ?? []);
    })
  );

  // ClickUp integration ---------------------------------------------------
  ipcMain.handle(
    'clickup:config:get',
    safe(async (): Promise<ClickUpConfig> => getClickUpConfig())
  );

  ipcMain.handle(
    'clickup:config:setToken',
    safe(async (_e, token: string | null) => {
      setApiToken(token);
    })
  );

  ipcMain.handle(
    'clickup:config:setRepo',
    safe(async (_e, repoId: string, cfg: ClickUpRepoConfig) => {
      setClickUpRepoConfig(repoId, cfg);
    })
  );

  ipcMain.handle(
    'clickup:auth:test',
    safe(async (_e, tokenOverride?: string) => {
      const token = (tokenOverride ?? getApiToken()) || '';
      if (!token) {
        throw new ClickUpClientError(
          'CLICKUP_NOT_CONFIGURED',
          'No ClickUp API token configured.'
        );
      }
      const user = await whoami(token);
      // Best-effort: cache teams and auto-pick one if user hasn't chosen yet.
      try {
        const teams = await getTeams(token);
        setTeams(teams);
        const current = getTeamId();
        if (!current && teams.length > 0) setTeamId(teams[0].id);
      } catch {
        /* token may lack workspace scope; let user pick manually later */
      }
      return user;
    })
  );

  ipcMain.handle(
    'clickup:config:setTeam',
    safe(async (_e, teamId: string | null) => {
      setTeamId(teamId);
    })
  );

  ipcMain.handle(
    'clickup:teams:list',
    safe(async () => {
      const token = getApiToken();
      if (!token) {
        throw new ClickUpClientError(
          'CLICKUP_NOT_CONFIGURED',
          'No ClickUp API token configured.'
        );
      }
      const teams = await getTeams(token);
      setTeams(teams);
      return teams;
    })
  );

  ipcMain.handle(
    'clickup:lists:statuses',
    safe(async (_e, listId: string) => {
      const token = getApiToken();
      if (!token) {
        throw new ClickUpClientError(
          'CLICKUP_NOT_CONFIGURED',
          'No ClickUp API token configured.'
        );
      }
      return getList(token, listId);
    })
  );

  ipcMain.handle(
    'clickup:task:byBranch',
    safe(async (_e, repoId: string, branch: string): Promise<ClickUpLookupResult> => {
      const token = getApiToken();
      const parsedTaskId = parseTaskIdFromBranch(branch);
      if (!token) return { linked: null, reason: 'no-token', parsedTaskId };
      if (!parsedTaskId) return { linked: null, reason: 'no-id', parsedTaskId: null };
      try {
        const task = await getTask(token, parsedTaskId, getTeamId());
        const repoCfg = getClickUpRepoConfig(repoId);
        const mapped = !!repoCfg.statusMap.codeReview;
        return { linked: { task, mapped }, parsedTaskId };
      } catch (err) {
        if (err instanceof ClickUpClientError && err.code === 'CLICKUP_NOT_FOUND') {
          return { linked: null, reason: 'not-found', parsedTaskId };
        }
        throw err;
      }
    })
  );

  ipcMain.handle(
    'clickup:task:comments',
    safe(async (_e, taskId: string) => {
      const token = getApiToken();
      if (!token) {
        throw new ClickUpClientError(
          'CLICKUP_NOT_CONFIGURED',
          'No ClickUp API token configured.'
        );
      }
      return getTaskComments(token, taskId);
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
