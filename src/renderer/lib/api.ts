import type { GhError } from '@shared/types';

export class ApiError extends Error {
  code: GhError['code'];
  stderr?: string;
  constructor(err: GhError) {
    super(err.message);
    this.code = err.code;
    this.stderr = err.stderr;
  }
}

/** Unwrap a Result envelope from the preload bridge into a plain promise. */
export async function unwrap<T>(
  p: Promise<{ ok: true; data: T } | { ok: false; error: GhError }>
): Promise<T> {
  const r = await p;
  if (r.ok) return r.data;
  throw new ApiError(r.error);
}

export const api = window.api;

export const qk = {
  repos: ['repos'] as const,
  prs: (repoId: string, state: string = 'open') => ['prs', repoId, state] as const,
  prDetail: (repoId: string, num: number) => ['pr', repoId, num] as const,
  prFiles: (repoId: string, num: number) => ['pr-files', repoId, num] as const,
  prComments: (repoId: string, num: number) => ['pr-comments', repoId, num] as const,
  prChecks: (repoId: string, num: number) => ['pr-checks', repoId, num] as const,
  prConflicts: (repoId: string, num: number) => ['pr-conflicts', repoId, num] as const,
  aiReview: (repoId: string, num: number) => ['ai-review', repoId, num] as const,
  aiAuth: ['ai-auth'] as const,
  editors: ['editors'] as const,
  systemTools: ['system', 'tools'] as const,
  clickupConfig: ['clickup', 'config'] as const,
  clickupTaskByBranch: (repoId: string, branch: string) =>
    ['clickup', 'task', repoId, branch] as const,
  clickupComments: (taskId: string) => ['clickup', 'comments', taskId] as const,
  clickupListStatuses: (listId: string) => ['clickup', 'list', listId] as const,
  jenkinsConfig: ['jenkins', 'config'] as const,
  jenkinsBuilds: (jobPath: string, branch: string) =>
    ['jenkins', 'builds', jobPath, branch] as const,
  jenkinsBuild: (jobPath: string, branch: string, num: number) =>
    ['jenkins', 'build', jobPath, branch, num] as const,
  jenkinsTests: (jobPath: string, branch: string, num: number) =>
    ['jenkins', 'tests', jobPath, branch, num] as const
};
