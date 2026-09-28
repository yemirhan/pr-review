import { dialog, ipcMain, BrowserWindow, shell } from 'electron';
import { existsSync } from 'node:fs';
import { GhClientError } from './gh/client';
import {
  listPRs,
  getPR,
  getFiles,
  getComments,
  getIssueComments,
  getOpenPRCounts,
  invalidatePR,
  AI_CONTEXT_MAX_AGE
} from './gh/prs';
import { getChecks } from './gh/checks';
import { submitReview } from './gh/review';
import { editPRTitle } from './gh/edit';
import { createPR, getRepoMeta, listBranches } from './gh/create';
import { mergePR } from './gh/merge';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  removeWorkspace,
  workspaceStatus
} from './git/workspaces';
import { clearReviewCache, listReviewCache } from './git/worktree';
import { listRepos, addRepo, removeRepo, findRepo } from './repo/store';
import { inspectRepo } from './repo/inspect';
import { getConflicts } from './git/conflicts';
import { detectEditors } from './editors/detect';
import { openInEditor } from './editors/open';
import { detectSystemTools } from './system/detect';
import { AIClientError } from './ai/client';
import { applyPreflight, applyReview, getAuthStatus, getDefaultDirective } from './ai/provider';
import {
  cancelReview,
  getSession,
  initSessions,
  listSessions,
  sendChat,
  setDismissed,
  startReview
} from './ai/sessions';
import { CLAUDE_MODELS, getAIConfig, setAIConfig } from './ai/config';
import { listCodexModels } from './ai/codex';
import { cancelStream, finishStream, registerStream } from './ai/cancel';
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
  getPublicConfig as getClickUpPublicConfig,
  getRepoConfig as getClickUpRepoConfig,
  getTeamId,
  setApiToken,
  setRepoConfig as setClickUpRepoConfig,
  setTeamId,
  setTeams
} from './integrations/clickup/config';
import { parseTaskIdFromBranch } from './integrations/clickup/branch';
import {
  JenkinsClientError,
  detectJobRepos,
  getBuild as getJenkinsBuild,
  getLogTail as getJenkinsLogTail,
  getTestReport as getJenkinsTestReport,
  listJobs as listJenkinsJobs,
  prBuilds as jenkinsPRBuilds,
  stopBuild as stopJenkinsBuild,
  testAuth as testJenkinsAuth,
  triggerBuild as triggerJenkinsBuild
} from './integrations/jenkins/client';
import {
  getAuthedConfig as getJenkinsAuthedConfig,
  getConfig as getJenkinsConfig,
  getPublicConfig as getJenkinsPublicConfig,
  setConnection as setJenkinsConnection,
  setRepoConfig as setJenkinsRepoConfig
} from './integrations/jenkins/config';
import {
  VercelClientError,
  listProjects as listVercelProjects,
  listTeams as listVercelTeams,
  prDeployments as vercelPRDeployments,
  whoami as vercelWhoami
} from './integrations/vercel/client';
import {
  getAuthedConfig as getVercelAuthedConfig,
  getConfig as getVercelConfig,
  getPublicConfig as getVercelPublicConfig,
  setProjectHidden as setVercelProjectHidden,
  setTeamId as setVercelTeamId,
  setToken as setVercelToken
} from './integrations/vercel/config';
import type {
  ReviewDraft,
  MergeOptions,
  MergeStrategy,
  Repo,
  CheckoutProgress,
  GhError,
  AIApplyProgressEvent,
  ReviewCacheInfo,
  AIProvider,
  AIReviewStartOptions,
  AIConfig,
  AIApplyProgress,
  ClickUpTask,
  ClickUpConfig,
  ClickUpRepoConfig,
  ClickUpLookupResult,
  PRListState,
  CreatePRInput,
  JenkinsConfig,
  JenkinsRepoConfig,
  JenkinsStatus,
  VercelConfig
} from '@shared/types';

function toErrPayload(err: unknown): GhError {
  if (err instanceof GhClientError) return err.toJSON();
  if (err instanceof AIClientError) return err.toJSON();
  if (err instanceof ClickUpClientError) return err.toJSON();
  if (err instanceof JenkinsClientError) return err.toJSON();
  if (err instanceof VercelClientError) return err.toJSON();
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

/**
 * Best-effort ClickUp task lookup for AI context. Swallows all errors —
 * a missing/invalid task should not block a review.
 */
async function tryLookupClickUpTask(branch: string): Promise<ClickUpTask | null> {
  try {
    const token = getApiToken();
    if (!token) return null;
    const id = parseTaskIdFromBranch(branch);
    if (!id) return null;
    return await getTask(token, id, getTeamId());
  } catch {
    return null;
  }
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
  initSessions(async (repo, num) => {
    const [pr, files] = await Promise.all([
      getPR(repo.owner, repo.name, num, AI_CONTEXT_MAX_AGE.detail),
      getFiles(repo.owner, repo.name, num, AI_CONTEXT_MAX_AGE.files)
    ]);
    return { pr, files, clickUpTask: await tryLookupClickUpTask(pr.headRefName) };
  });

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

  ipcMain.handle(
    'repos:reveal',
    safe(async (_e, id: string) => {
      const repo = findRepo(id);
      if (!repo) throw new Error('Repo not found');
      const err = await shell.openPath(repo.path);
      if (err) throw new Error(err);
    })
  );

  ipcMain.handle(
    'repos:openCounts',
    safe(async (): Promise<Record<string, number>> => getOpenPRCounts(listRepos()))
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
    'prs:create',
    safe(async (_e, repoId: string, input: CreatePRInput) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const title = input.title.trim();
      const base = input.base.trim();
      const head = input.head.trim();
      if (!title) throw new Error('Title cannot be empty');
      if (!base) throw new Error('Base branch is required');
      if (!head) throw new Error('Head branch is required');
      if (base === head) throw new Error('Base and head must differ');
      return createPR(repo.owner, repo.name, {
        title,
        base,
        head,
        body: input.body ?? '',
        draft: !!input.draft
      });
    })
  );

  ipcMain.handle(
    'prs:branches',
    safe(async (_e, repoId: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const [meta, branches] = await Promise.all([
        getRepoMeta(repo.owner, repo.name),
        listBranches(repo.owner, repo.name)
      ]);
      return { defaultBranch: meta.defaultBranch, branches };
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

  ipcMain.handle(
    'prs:issueComments',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getIssueComments(repo.owner, repo.name, num);
    })
  );

  ipcMain.handle(
    'prs:checks',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return getChecks(repo.owner, repo.name, num);
    })
  );

  // Drop the main-process cache for a PR so the next fetch hits GitHub.
  ipcMain.handle(
    'prs:refresh',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      invalidatePR(repo.owner, repo.name, num);
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
    safe(async (_e, repoId: string, num: number, strategy: MergeStrategy, opts?: MergeOptions) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      await mergePR(repo.owner, repo.name, num, strategy, opts ?? {});
    })
  );

  // PR workspaces (one worktree per PR) ---------------------------------------
  ipcMain.handle(
    'review:checkout',
    safe(async (e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const win = BrowserWindow.fromWebContents(e.sender);
      const send = (msg: CheckoutProgress) => win?.webContents.send('checkout:progress', msg);
      try {
        const pr = await getPR(repo.owner, repo.name, num);
        const ws = await createWorkspace(repo, pr, (data) => send({ channel: 'stdout', data }));
        send({ channel: 'done', data: '', exitCode: 0 });
        return ws;
      } catch (err) {
        const ge = err as { message?: string; stderr?: string };
        send({ channel: 'error', data: `${ge.stderr ? `${ge.stderr}\n` : ''}${ge.message ?? String(err)}\n` });
        send({ channel: 'done', data: '', exitCode: 1 });
        throw err;
      }
    })
  );

  ipcMain.handle(
    'workspace:get',
    safe(async (_e, repoId: string, num: number) => workspaceStatus(repoId, num))
  );

  ipcMain.handle(
    'workspace:list',
    safe(async () =>
      listWorkspaces(async (repoId, num) => {
        const repo = findRepo(repoId);
        if (!repo) return null;
        const pr = await getPR(repo.owner, repo.name, num, AI_CONTEXT_MAX_AGE.detail);
        return { state: pr.state, title: pr.title };
      })
    )
  );

  ipcMain.handle(
    'workspace:remove',
    safe(async (_e, repoId: string, num: number, force?: boolean) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return removeWorkspace(repo, num, { force: !!force });
    })
  );

  ipcMain.handle(
    'workspace:reveal',
    safe(async (_e, repoId: string, num: number) => {
      const ws = getWorkspace(repoId, num);
      if (!ws) throw new Error('No worktree for this PR');
      shell.showItemInFolder(ws.path);
    })
  );

  ipcMain.handle(
    'reviewCache:info',
    safe(async (): Promise<ReviewCacheInfo> => {
      const list = listReviewCache();
      return { count: list.length, inUse: list.filter((x) => x.inUse).length };
    })
  );

  ipcMain.handle(
    'reviewCache:clear',
    safe(async () => clearReviewCache())
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
    safe(async (_e, editorId: string, repoId: string, relativePath?: string, prNumber?: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      // A PR with its own worktree opens there, not in the main checkout.
      const root = (prNumber != null ? getWorkspace(repoId, prNumber)?.path : null) ?? repo.path;
      const target = relativePath ? `${root}/${relativePath}` : root;
      await openInEditor(editorId, target);
    })
  );

  // AI review -------------------------------------------------------------
  ipcMain.handle(
    'ai:auth:status',
    safe(async (_e, provider?: AIProvider) => getAuthStatus(provider))
  );

  ipcMain.handle(
    'ai:config:get',
    safe(async (): Promise<AIConfig> => getAIConfig())
  );

  ipcMain.handle(
    'ai:config:set',
    safe(async (_e, patch: Partial<AIConfig>): Promise<AIConfig> => setAIConfig(patch))
  );

  ipcMain.handle(
    'ai:codex:models',
    safe(async () => listCodexModels())
  );

  ipcMain.handle(
    'ai:claude:models',
    safe(async () => CLAUDE_MODELS)
  );

  ipcMain.handle(
    'ai:directive:default',
    safe(async () => getDefaultDirective())
  );

  ipcMain.handle(
    'ai:session:get',
    safe(async (_e, repoId: string, num: number) => getSession(repoId, num))
  );

  ipcMain.handle(
    'ai:session:list',
    safe(async () => listSessions())
  );

  ipcMain.handle(
    'ai:session:start',
    safe(async (_e, repoId: string, num: number, opts?: AIReviewStartOptions) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return startReview(repo, num, opts ?? {});
    })
  );

  ipcMain.handle(
    'ai:session:cancel',
    safe(async (_e, repoId: string, num: number) => cancelReview(repoId, num))
  );

  ipcMain.handle(
    'ai:session:dismiss',
    safe(async (_e, repoId: string, num: number, findingId: string, dismissed: boolean) =>
      setDismissed(repoId, num, findingId, dismissed)
    )
  );

  ipcMain.handle(
    'ai:session:chat',
    safe(async (_e, repoId: string, num: number, message: string, findingId?: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return sendChat(repo, num, message, findingId);
    })
  );

  ipcMain.handle(
    'ai:cancel',
    safe(async (_e, streamId: string) => cancelStream(streamId))
  );

  ipcMain.handle(
    'ai:apply:preflight',
    safe(async (_e, repoId: string, num: number) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const ws = getWorkspace(repoId, num);
      if (!ws) {
        // Fixes are applied in the PR's worktree only, never the main checkout.
        return { currentBranch: '', branchMatches: false, dirty: false };
      }
      const pre = await applyPreflight(ws.path, ws.branch);
      return pre;
    })
  );

  ipcMain.handle(
    'ai:apply',
    safe(async (e, repoId: string, num: number, review: string, streamId: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const pr = await getPR(repo.owner, repo.name, num);
      const ws = getWorkspace(repoId, num);
      if (!ws) {
        throw new AIClientError('AI_WRONG_BRANCH', 'Check out this PR in a worktree first.');
      }
      const pre = await applyPreflight(ws.path, ws.branch);
      if (pre.dirty) {
        throw new AIClientError(
          'AI_WORKING_TREE_DIRTY',
          'Working tree has uncommitted changes. Commit or stash them before applying AI changes.'
        );
      }
      const win = BrowserWindow.fromWebContents(e.sender);
      const ac = registerStream(streamId);
      try {
        return await applyReview({
          provider: getSession(repoId, num)?.provider ?? getAIConfig().provider,
          repoPath: ws.path,
          pr,
          review,
          signal: ac.signal,
          onProgress: (event: AIApplyProgress) => {
            const payload: AIApplyProgressEvent = { streamId, event };
            win?.webContents.send('ai:apply:progress', payload);
          }
        });
      } finally {
        finishStream(streamId);
      }
    })
  );

  ipcMain.handle(
    'ai:apply:push',
    safe(async (_e, repoId: string, num: number, message: string) => {
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      const ws = getWorkspace(repoId, num);
      if (!ws) throw new Error('This PR has no worktree');
      const trimmed = message.trim();
      if (!trimmed) throw new Error('Commit message cannot be empty');
      await commitAndPush(ws.path, trimmed);
    })
  );

  ipcMain.handle(
    'ai:apply:discard',
    safe(async (_e, repoId: string, num: number, untrackedBefore: string[]) => {
      const ws = getWorkspace(repoId, num);
      if (!ws) throw new Error('This PR has no worktree');
      await discardWorkingChanges(ws.path, untrackedBefore ?? []);
    })
  );

  // ClickUp integration ---------------------------------------------------
  ipcMain.handle(
    'clickup:config:get',
    safe(async (): Promise<ClickUpConfig> => getClickUpPublicConfig())
  );

  ipcMain.handle(
    'clickup:status',
    safe(async () => {
      const token = getApiToken();
      if (!token) return { state: 'unconfigured' as const };
      try {
        const res = await whoami(token);
        return { state: 'ok' as const, user: res.user?.username ?? 'authenticated' };
      } catch (e) {
        return { state: 'error' as const, message: (e as Error).message };
      }
    })
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

  // Jenkins integration ---------------------------------------------------
  ipcMain.handle(
    'jenkins:config:get',
    safe(async (): Promise<JenkinsConfig> => getJenkinsPublicConfig())
  );

  ipcMain.handle(
    'jenkins:status',
    safe(async (): Promise<JenkinsStatus> => {
      const c = getJenkinsConfig();
      if (!c.baseUrl || !c.username || !c.apiToken) return { state: 'unconfigured' };
      try {
        const res = await testJenkinsAuth({ baseUrl: c.baseUrl, username: c.username, apiToken: c.apiToken });
        return { state: 'ok', user: res.user ?? c.username, baseUrl: c.baseUrl, username: c.username };
      } catch (e) {
        const err = e as JenkinsClientError;
        return { state: 'error', code: err.code ?? 'JENKINS_FAILED', message: err.message, baseUrl: c.baseUrl, username: c.username };
      }
    })
  );

  /** Test and save. A null token keeps the saved one (editing just the URL). */
  ipcMain.handle(
    'jenkins:connect',
    safe(async (_e, input: { baseUrl: string; username: string; apiToken: string | null }): Promise<JenkinsStatus> => {
      const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
      const username = input.username.trim();
      const apiToken = (input.apiToken ?? getJenkinsConfig().apiToken ?? '').trim();
      if (!/^https?:\/\//i.test(baseUrl)) {
        throw new JenkinsClientError('JENKINS_NOT_CONFIGURED', 'Enter the Jenkins URL, starting with https://');
      }
      if (!username || !apiToken) {
        throw new JenkinsClientError('JENKINS_NOT_CONFIGURED', 'Username and API token are both required.');
      }
      const res = await testJenkinsAuth({ baseUrl, username, apiToken });
      setJenkinsConnection(baseUrl, username, apiToken);
      return { state: 'ok', user: res.user ?? username, baseUrl, username };
    })
  );

  ipcMain.handle(
    'jenkins:disconnect',
    safe(async () => {
      const c = getJenkinsConfig();
      // Keep the URL and username so reconnecting only needs a new token.
      setJenkinsConnection(c.baseUrl, c.username, null);
    })
  );

  ipcMain.handle(
    'jenkins:config:setRepo',
    safe(async (_e, repoId: string, cfg: JenkinsRepoConfig | null) => {
      setJenkinsRepoConfig(repoId, cfg);
    })
  );

  function requireJenkins() {
    const cfg = getJenkinsAuthedConfig();
    if (!cfg) {
      throw new JenkinsClientError(
        'JENKINS_NOT_CONFIGURED',
        'Jenkins is not connected. Connect it in Settings → Jenkins.'
      );
    }
    return cfg;
  }

  ipcMain.handle(
    'jenkins:jobs:list',
    safe(async (_e, fresh?: boolean) => listJenkinsJobs(requireJenkins(), !!fresh))
  );

  ipcMain.handle(
    'jenkins:jobs:detect',
    safe(async () => {
      const cfg = requireJenkins();
      return detectJobRepos(cfg, await listJenkinsJobs(cfg));
    })
  );

  ipcMain.handle(
    'jenkins:pr:builds',
    safe(async (_e, repoId: string, branch: string, prNumber: number | null, fresh?: boolean) => {
      const cfg = requireJenkins();
      const pipelines = cfg.repos[repoId]?.pipelines ?? [];
      return jenkinsPRBuilds(cfg, pipelines, branch, prNumber, { fresh: !!fresh });
    })
  );

  ipcMain.handle(
    'jenkins:build:get',
    safe(async (_e, buildUrl: string) => getJenkinsBuild(requireJenkins(), buildUrl))
  );

  ipcMain.handle(
    'jenkins:build:tests',
    safe(async (_e, buildUrl: string) => getJenkinsTestReport(requireJenkins(), buildUrl))
  );

  ipcMain.handle(
    'jenkins:build:log',
    safe(async (_e, buildUrl: string) => getJenkinsLogTail(requireJenkins(), buildUrl))
  );

  ipcMain.handle(
    'jenkins:build:trigger',
    safe(async (_e, branchJobUrl: string) => triggerJenkinsBuild(requireJenkins(), branchJobUrl))
  );

  ipcMain.handle(
    'jenkins:build:stop',
    safe(async (_e, buildUrl: string) => stopJenkinsBuild(requireJenkins(), buildUrl))
  );

  // Vercel integration ----------------------------------------------------
  ipcMain.handle(
    'vercel:config:get',
    safe(async (): Promise<VercelConfig> => getVercelPublicConfig())
  );

  /** Test and save a token; picks the only team when there's exactly one. */
  ipcMain.handle(
    'vercel:connect',
    safe(async (_e, token: string) => {
      const t = token.trim();
      if (!t) throw new VercelClientError('VERCEL_NOT_CONFIGURED', 'Paste a Vercel token.');
      const res = await vercelWhoami({ token: t, teamId: null });
      setVercelToken(t);
      const teams = await listVercelTeams({ token: t, teamId: null }).catch(() => []);
      const current = getVercelConfig().teamId;
      if (!teams.some((x) => x.id === current)) setVercelTeamId(teams.length === 1 ? teams[0].id : null);
      return res;
    })
  );

  ipcMain.handle(
    'vercel:disconnect',
    safe(async () => {
      setVercelToken(null);
    })
  );

  ipcMain.handle(
    'vercel:status',
    safe(async () => {
      const c = getVercelConfig();
      if (!c.token) return { state: 'unconfigured' as const };
      try {
        const res = await vercelWhoami({ token: c.token, teamId: null });
        return { state: 'ok' as const, user: res.user ?? 'authenticated' };
      } catch (e) {
        return { state: 'error' as const, message: (e as Error).message };
      }
    })
  );

  ipcMain.handle(
    'vercel:config:setTeamId',
    safe(async (_e, teamId: string | null) => {
      setVercelTeamId(teamId);
    })
  );

  ipcMain.handle(
    'vercel:config:setProjectHidden',
    safe(async (_e, projectId: string, hidden: boolean) => {
      setVercelProjectHidden(projectId, hidden);
    })
  );

  function requireVercel() {
    const cfg = getVercelAuthedConfig();
    if (!cfg) {
      throw new VercelClientError(
        'VERCEL_NOT_CONFIGURED',
        'Vercel is not connected. Connect it in Settings → Vercel.'
      );
    }
    return cfg;
  }

  ipcMain.handle(
    'vercel:teams:list',
    safe(async () => listVercelTeams(requireVercel()))
  );

  ipcMain.handle(
    'vercel:projects:list',
    safe(async (_e, fresh?: boolean) => listVercelProjects(requireVercel(), !!fresh))
  );

  ipcMain.handle(
    'vercel:pr:deployments',
    safe(async (_e, repoId: string, branch: string, headSha: string) => {
      const cfg = requireVercel();
      const repo = findRepo(repoId);
      if (!repo) throw new Error('Repo not found');
      return vercelPRDeployments(cfg, {
        owner: repo.owner,
        name: repo.name,
        branch,
        headSha,
        hidden: cfg.hiddenProjects
      });
    })
  );

  // System ----------------------------------------------------------------
  ipcMain.handle(
    'system:tools',
    safe(async () => detectSystemTools())
  );

  // Misc ------------------------------------------------------------------
  ipcMain.handle(
    'shell:openExternal',
    safe(async (_e, url: string) => {
      await shell.openExternal(url);
    })
  );
}
