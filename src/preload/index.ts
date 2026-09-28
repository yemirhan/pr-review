import { contextBridge, ipcRenderer } from 'electron';
import type {
  Repo,
  PRSummary,
  PRDetail,
  FileDiff,
  InlineCommentThread,
  ReviewDraft,
  MergeOptions,
  MergeStrategy,
  CheckoutProgress,
  GhError,
  ConflictInfo,
  Editor,
  AIAuthStatus,
  AIClaudeModel,
  AIProvider,
  AIReviewStartOptions,
  AISession,
  AISessionSummary,
  AIApplyProgressEvent,
  PRWorkspace,
  PRWorkspaceStatus,
  ReviewCacheInfo,
  AIConfig,
  AICodexModel,
  PRIssueComment,
  AIApplyPreflight,
  AIApplyResult,
  ClickUpConfig,
  ClickUpRepoConfig,
  ClickUpLookupResult,
  ClickUpComment,
  ClickUpAuthResult,
  ClickUpStatus,
  PRListState,
  CreatePRInput,
  SystemTool,
  PRCheckRun,
  JenkinsConfig,
  JenkinsRepoConfig,
  JenkinsBuildDetail,
  JenkinsJob,
  JenkinsPRBuilds,
  JenkinsStatus,
  JenkinsTestSummary,
  VercelConfig,
  VercelAuthResult,
  VercelPRDeployments,
  VercelProjectLookup,
  VercelTeam
} from '@shared/types';

export type Result<T> = { ok: true; data: T } | { ok: false; error: GhError };

function call<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  repos: {
    list: () => call<Repo[]>('repos:list'),
    add: () => call<Repo | null>('repos:add'),
    remove: (id: string) => call<void>('repos:remove', id),
    reveal: (id: string) => call<void>('repos:reveal', id),
    openCounts: () => call<Record<string, number>>('repos:openCounts')
  },
  prs: {
    list: (repoId: string, state?: PRListState) =>
      call<PRSummary[]>('prs:list', repoId, state),
    get: (repoId: string, num: number) => call<PRDetail>('prs:get', repoId, num),
    files: (repoId: string, num: number) => call<FileDiff[]>('prs:files', repoId, num),
    comments: (repoId: string, num: number) =>
      call<InlineCommentThread[]>('prs:comments', repoId, num),
    issueComments: (repoId: string, num: number) =>
      call<PRIssueComment[]>('prs:issueComments', repoId, num),
    checks: (repoId: string, num: number) =>
      call<PRCheckRun[]>('prs:checks', repoId, num),
    refresh: (repoId: string, num: number) => call<void>('prs:refresh', repoId, num),
    conflicts: (repoId: string, num: number, baseRefName: string) =>
      call<ConflictInfo>('prs:conflicts', repoId, num, baseRefName),
    editTitle: (repoId: string, num: number, title: string) =>
      call<void>('prs:editTitle', repoId, num, title),
    create: (repoId: string, input: CreatePRInput) =>
      call<number>('prs:create', repoId, input),
    branches: (repoId: string) =>
      call<{ defaultBranch: string; branches: string[] }>('prs:branches', repoId)
  },
  editors: {
    list: () => call<Editor[]>('editors:list'),
    /** With `prNumber`, opens the PR's worktree when it has one. */
    open: (editorId: string, repoId: string, relativePath?: string, prNumber?: number) =>
      call<void>('editors:open', editorId, repoId, relativePath, prNumber)
  },
  // PR worktrees (see main/git/workspaces.ts)
  workspaces: {
    get: (repoId: string, num: number) => call<PRWorkspaceStatus | null>('workspace:get', repoId, num),
    list: () => call<PRWorkspaceStatus[]>('workspace:list'),
    remove: (repoId: string, num: number, force?: boolean) =>
      call<{ branchDeleted: boolean }>('workspace:remove', repoId, num, force),
    reveal: (repoId: string, num: number) => call<void>('workspace:reveal', repoId, num),
    reviewCacheInfo: () => call<ReviewCacheInfo>('reviewCache:info'),
    clearReviewCache: () => call<number>('reviewCache:clear')
  },
  review: {
    submit: (repoId: string, num: number, draft: ReviewDraft) =>
      call<void>('review:submit', repoId, num, draft),
    merge: (repoId: string, num: number, strategy: MergeStrategy, opts?: MergeOptions) =>
      call<void>('review:merge', repoId, num, strategy, opts),
    checkout: (repoId: string, num: number) =>
      call<PRWorkspace>('review:checkout', repoId, num)
  },
  events: {
    onCheckoutProgress(cb: (msg: CheckoutProgress) => void): () => void {
      const handler = (_e: unknown, msg: CheckoutProgress) => cb(msg);
      ipcRenderer.on('checkout:progress', handler);
      return () => {
        ipcRenderer.removeListener('checkout:progress', handler);
      };
    },
    onMenuCommand(cb: (cmd: 'close-tab' | 'next-tab' | 'prev-tab') => void): () => void {
      const handler = (_e: unknown, cmd: 'close-tab' | 'next-tab' | 'prev-tab') => cb(cmd);
      ipcRenderer.on('menu:command', handler);
      return () => {
        ipcRenderer.removeListener('menu:command', handler);
      };
    },
    onAISession(cb: (session: AISession) => void): () => void {
      const handler = (_e: unknown, session: AISession) => cb(session);
      ipcRenderer.on('ai:session', handler);
      return () => {
        ipcRenderer.removeListener('ai:session', handler);
      };
    },
    onAIApplyProgress(cb: (event: AIApplyProgressEvent) => void): () => void {
      const handler = (_e: unknown, event: AIApplyProgressEvent) => cb(event);
      ipcRenderer.on('ai:apply:progress', handler);
      return () => {
        ipcRenderer.removeListener('ai:apply:progress', handler);
      };
    }
  },
  ai: {
    authStatus: (provider?: AIProvider) => call<AIAuthStatus>('ai:auth:status', provider),
    getConfig: () => call<AIConfig>('ai:config:get'),
    setConfig: (patch: Partial<AIConfig>) => call<AIConfig>('ai:config:set', patch),
    codexModels: () => call<AICodexModel[]>('ai:codex:models'),
    claudeModels: () => call<AIClaudeModel[]>('ai:claude:models'),
    defaultDirective: () => call<string>('ai:directive:default'),
    cancel: (streamId: string) => call<boolean>('ai:cancel', streamId),
    session: (repoId: string, num: number) =>
      call<AISession | null>('ai:session:get', repoId, num),
    sessions: () => call<AISessionSummary[]>('ai:session:list'),
    startReview: (repoId: string, num: number, opts?: AIReviewStartOptions) =>
      call<AISession>('ai:session:start', repoId, num, opts),
    cancelReview: (repoId: string, num: number) => call<void>('ai:session:cancel', repoId, num),
    dismiss: (repoId: string, num: number, findingId: string, dismissed: boolean) =>
      call<AISession | null>('ai:session:dismiss', repoId, num, findingId, dismissed),
    chat: (repoId: string, num: number, message: string, findingId?: string) =>
      call<AISession>('ai:session:chat', repoId, num, message, findingId),
    applyPreflight: (repoId: string, num: number) =>
      call<AIApplyPreflight>('ai:apply:preflight', repoId, num),
    apply: (repoId: string, num: number, review: string, streamId: string) =>
      call<AIApplyResult>('ai:apply', repoId, num, review, streamId),
    push: (repoId: string, num: number, message: string) =>
      call<void>('ai:apply:push', repoId, num, message),
    discard: (repoId: string, num: number, untrackedBefore: string[]) =>
      call<void>('ai:apply:discard', repoId, num, untrackedBefore)
  },
  shell: {
    openExternal: (url: string) => call<void>('shell:openExternal', url)
  },
  system: {
    tools: () => call<SystemTool[]>('system:tools')
  },
  integrations: {
    clickup: {
      getConfig: () => call<ClickUpConfig>('clickup:config:get'),
      status: () =>
        call<{ state: 'unconfigured' } | { state: 'ok'; user: string } | { state: 'error'; message: string }>(
          'clickup:status'
        ),
      setToken: (token: string | null) => call<void>('clickup:config:setToken', token),
      setTeam: (teamId: string | null) => call<void>('clickup:config:setTeam', teamId),
      listTeams: () => call<{ id: string; name: string }[]>('clickup:teams:list'),
      setRepoConfig: (repoId: string, cfg: ClickUpRepoConfig) =>
        call<void>('clickup:config:setRepo', repoId, cfg),
      testAuth: (tokenOverride?: string) =>
        call<ClickUpAuthResult>('clickup:auth:test', tokenOverride),
      getListStatuses: (listId: string) =>
        call<{ id: string; name: string; statuses: ClickUpStatus[] }>(
          'clickup:lists:statuses',
          listId
        ),
      taskByBranch: (repoId: string, branch: string) =>
        call<ClickUpLookupResult>('clickup:task:byBranch', repoId, branch),
      taskComments: (taskId: string) =>
        call<ClickUpComment[]>('clickup:task:comments', taskId)
    },
    jenkins: {
      getConfig: () => call<JenkinsConfig>('jenkins:config:get'),
      status: () => call<JenkinsStatus>('jenkins:status'),
      connect: (input: { baseUrl: string; username: string; apiToken: string | null }) =>
        call<JenkinsStatus>('jenkins:connect', input),
      disconnect: () => call<void>('jenkins:disconnect'),
      setRepoConfig: (repoId: string, cfg: JenkinsRepoConfig | null) =>
        call<void>('jenkins:config:setRepo', repoId, cfg),
      listJobs: (fresh?: boolean) => call<JenkinsJob[]>('jenkins:jobs:list', fresh),
      detectJobRepos: () => call<Record<string, string | null>>('jenkins:jobs:detect'),
      prBuilds: (repoId: string, branch: string, prNumber: number | null, fresh?: boolean) =>
        call<JenkinsPRBuilds>('jenkins:pr:builds', repoId, branch, prNumber, fresh),
      getBuild: (buildUrl: string) => call<JenkinsBuildDetail>('jenkins:build:get', buildUrl),
      getTests: (buildUrl: string) => call<JenkinsTestSummary | null>('jenkins:build:tests', buildUrl),
      getLog: (buildUrl: string) => call<string>('jenkins:build:log', buildUrl),
      triggerBuild: (branchJobUrl: string) => call<void>('jenkins:build:trigger', branchJobUrl),
      stopBuild: (buildUrl: string) => call<void>('jenkins:build:stop', buildUrl)
    },
    vercel: {
      getConfig: () => call<VercelConfig>('vercel:config:get'),
      status: () =>
        call<{ state: 'unconfigured' } | { state: 'ok'; user: string } | { state: 'error'; message: string }>(
          'vercel:status'
        ),
      connect: (token: string) => call<VercelAuthResult>('vercel:connect', token),
      disconnect: () => call<void>('vercel:disconnect'),
      setTeamId: (teamId: string | null) => call<void>('vercel:config:setTeamId', teamId),
      setProjectHidden: (projectId: string, hidden: boolean) =>
        call<void>('vercel:config:setProjectHidden', projectId, hidden),
      listTeams: () => call<VercelTeam[]>('vercel:teams:list'),
      listProjects: (fresh?: boolean) => call<VercelProjectLookup[]>('vercel:projects:list', fresh),
      prDeployments: (repoId: string, branch: string, headSha: string) =>
        call<VercelPRDeployments>('vercel:pr:deployments', repoId, branch, headSha)
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
