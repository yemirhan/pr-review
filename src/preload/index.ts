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
  Editor
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
    list: (repoId: string) => call<PRSummary[]>('prs:list', repoId),
    get: (repoId: string, num: number) => call<PRDetail>('prs:get', repoId, num),
    files: (repoId: string, num: number) => call<FileDiff[]>('prs:files', repoId, num),
    comments: (repoId: string, num: number) =>
      call<InlineCommentThread[]>('prs:comments', repoId, num),
    conflicts: (repoId: string, num: number, baseRefName: string) =>
      call<ConflictInfo>('prs:conflicts', repoId, num, baseRefName)
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
    }
  },
  shell: {
    openExternal: (url: string) => call<void>('shell:openExternal', url)
  }
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
