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
  AIApplyPreflight,
  AIApplyProgress,
  AIApplyResult,
  ClickUpConfig,
  ClickUpRepoConfig,
  ClickUpLookupResult,
  ClickUpComment,
  ClickUpAuthResult,
  ClickUpStatus,
  PRListState
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
    conflicts: (repoId: string, num: number, baseRefName: string) =>
      call<ConflictInfo>('prs:conflicts', repoId, num, baseRefName),
    editTitle: (repoId: string, num: number, title: string) =>
      call<void>('prs:editTitle', repoId, num, title)
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
    review: (repoId: string, num: number) =>
      call<AIReviewResult>('ai:review', repoId, num),
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
    }
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
