import { contextBridge, ipcRenderer } from 'electron';
import type {
  Repo,
  PRSummary,
  PRDetail,
  FileDiff,
  InlineCommentThread,
  ReviewDraft,
  MergeStrategy,
  CheckoutProgress,
  GhError,
  ConflictInfo,
  Editor,
  AIAuthStatus,
  AIReviewChunk,
  AIReviewResult,
  AIReviewOptions,
  AIChatRequest,
  AIChatResult,
  AIApplyPreflight,
  AIApplyProgress,
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
  JenkinsAuthResult,
  JenkinsBuild,
  JenkinsBuildDetail,
  JenkinsTestSummary,
  VercelConfig,
  VercelRepoConfig,
  VercelAuthResult,
  VercelDeployment,
  VercelProjectLookup
} from '@shared/types';

export type Result<T> = { ok: true; data: T } | { ok: false; error: GhError };

function call<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  repos: {
    list: () => call<Repo[]>('repos:list'),
    add: () => call<Repo | null>('repos:add'),
    remove: (id: string) => call<void>('repos:remove', id)
  },
  prs: {
    list: (repoId: string, state?: PRListState) =>
      call<PRSummary[]>('prs:list', repoId, state),
    get: (repoId: string, num: number) => call<PRDetail>('prs:get', repoId, num),
    files: (repoId: string, num: number) => call<FileDiff[]>('prs:files', repoId, num),
    comments: (repoId: string, num: number) =>
      call<InlineCommentThread[]>('prs:comments', repoId, num),
    checks: (repoId: string, num: number) =>
      call<PRCheckRun[]>('prs:checks', repoId, num),
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
    open: (editorId: string, repoId: string, relativePath?: string) =>
      call<void>('editors:open', editorId, repoId, relativePath)
  },
  review: {
    submit: (repoId: string, num: number, draft: ReviewDraft) =>
      call<void>('review:submit', repoId, num, draft),
    merge: (repoId: string, num: number, strategy: MergeStrategy) =>
      call<void>('review:merge', repoId, num, strategy),
    checkout: (repoId: string, num: number) =>
      call<{ exitCode: number }>('review:checkout', repoId, num)
  },
  events: {
    onCheckoutProgress(cb: (msg: CheckoutProgress) => void): () => void {
      const handler = (_e: unknown, msg: CheckoutProgress) => cb(msg);
      ipcRenderer.on('checkout:progress', handler);
      return () => {
        ipcRenderer.removeListener('checkout:progress', handler);
      };
    },
    onAIReviewChunk(cb: (chunk: AIReviewChunk) => void): () => void {
      const handler = (_e: unknown, chunk: AIReviewChunk) => cb(chunk);
      ipcRenderer.on('ai:review:chunk', handler);
      return () => {
        ipcRenderer.removeListener('ai:review:chunk', handler);
      };
    },
    onAIApplyProgress(cb: (event: AIApplyProgress) => void): () => void {
      const handler = (_e: unknown, event: AIApplyProgress) => cb(event);
      ipcRenderer.on('ai:apply:progress', handler);
      return () => {
        ipcRenderer.removeListener('ai:apply:progress', handler);
      };
    }
  },
  ai: {
    authStatus: () => call<AIAuthStatus>('ai:auth:status'),
    review: (repoId: string, num: number, opts: AIReviewOptions, streamId: string) =>
      call<AIReviewResult>('ai:review', repoId, num, opts, streamId),
    chat: (repoId: string, num: number, req: AIChatRequest) =>
      call<AIChatResult>('ai:chat', repoId, num, req),
    applyPreflight: (repoId: string, num: number) =>
      call<AIApplyPreflight>('ai:apply:preflight', repoId, num),
    apply: (repoId: string, num: number, review: string) =>
      call<AIApplyResult>('ai:apply', repoId, num, review),
    push: (repoId: string, message: string) =>
      call<void>('ai:apply:push', repoId, message),
    discard: (repoId: string, untrackedBefore: string[]) =>
      call<void>('ai:apply:discard', repoId, untrackedBefore)
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
      setBaseUrl: (url: string | null) => call<void>('jenkins:config:setBaseUrl', url),
      setCredentials: (username: string | null, apiToken: string | null) =>
        call<void>('jenkins:config:setCredentials', username, apiToken),
      setRepoConfig: (repoId: string, cfg: JenkinsRepoConfig | null) =>
        call<void>('jenkins:config:setRepo', repoId, cfg),
      testAuth: (override?: {
        baseUrl?: string;
        username?: string;
        apiToken?: string;
      }) => call<JenkinsAuthResult>('jenkins:auth:test', override),
      listBuilds: (jobPath: string, branch: string, limit?: number) =>
        call<JenkinsBuild[]>('jenkins:builds:list', jobPath, branch, limit),
      getBuild: (jobPath: string, branch: string, buildNumber: number) =>
        call<JenkinsBuildDetail>('jenkins:builds:get', jobPath, branch, buildNumber),
      getTests: (jobPath: string, branch: string, buildNumber: number) =>
        call<JenkinsTestSummary | null>('jenkins:builds:tests', jobPath, branch, buildNumber),
      triggerBuild: (jobPath: string, branch: string) =>
        call<void>('jenkins:builds:trigger', jobPath, branch)
    },
    vercel: {
      getConfig: () => call<VercelConfig>('vercel:config:get'),
      setToken: (token: string | null) => call<void>('vercel:config:setToken', token),
      setTeamId: (teamId: string | null) =>
        call<void>('vercel:config:setTeamId', teamId),
      setRepoConfig: (repoId: string, cfg: VercelRepoConfig | null) =>
        call<void>('vercel:config:setRepo', repoId, cfg),
      testAuth: (override?: { token?: string; teamId?: string | null }) =>
        call<VercelAuthResult>('vercel:auth:test', override),
      listProjects: () => call<VercelProjectLookup[]>('vercel:projects:list'),
      listDeployments: (projectId: string, branch: string, limit?: number) =>
        call<VercelDeployment[]>('vercel:deployments:list', projectId, branch, limit)
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
