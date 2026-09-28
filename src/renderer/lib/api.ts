import type { GhError } from '@shared/types';

export class ApiError extends Error {
  code: GhError['code'];
  stderr?: string;
  retryAfterMs?: number;
  constructor(err: GhError) {
    super(err.message);
    this.code = err.code;
    this.stderr = err.stderr;
    this.retryAfterMs = err.retryAfterMs;
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
  openCounts: ['repos', 'open-counts'] as const,
  prs: (repoId: string, state: string = 'open') => ['prs', repoId, state] as const,
  prDetail: (repoId: string, num: number) => ['pr', repoId, num] as const,
  prFiles: (repoId: string, num: number) => ['pr-files', repoId, num] as const,
  prComments: (repoId: string, num: number) => ['pr-comments', repoId, num] as const,
  prIssueComments: (repoId: string, num: number) => ['pr-issue-comments', repoId, num] as const,
  prChecks: (repoId: string, num: number) => ['pr-checks', repoId, num] as const,
  prConflicts: (repoId: string, num: number) => ['pr-conflicts', repoId, num] as const,
  aiSession: (repoId: string, num: number) => ['ai', 'session', repoId, num] as const,
  aiSessions: ['ai', 'sessions'] as const,
  workspace: (repoId: string, num: number) => ['workspace', repoId, num] as const,
  workspaces: ['workspace', 'list'] as const,
  reviewCache: ['workspace', 'review-cache'] as const,
  aiAuth: (provider?: string) => ['ai-auth', provider ?? 'default'] as const,
  claudeModels: ['ai', 'claude', 'models'] as const,
  aiConfig: ['ai', 'config'] as const,
  codexModels: ['ai', 'codex', 'models'] as const,
  editors: ['editors'] as const,
  systemTools: ['system', 'tools'] as const,
  clickupConfig: ['clickup', 'config'] as const,
  clickupStatus: ['clickup', 'status'] as const,
  clickupTaskByBranch: (repoId: string, branch: string) =>
    ['clickup', 'task', repoId, branch] as const,
  clickupComments: (taskId: string) => ['clickup', 'comments', taskId] as const,
  clickupListStatuses: (listId: string) => ['clickup', 'list', listId] as const,
  jenkinsConfig: ['jenkins', 'config'] as const,
  jenkinsStatus: ['jenkins', 'status'] as const,
  jenkinsJobs: ['jenkins', 'jobs'] as const,
  jenkinsPRBuilds: (repoId: string, branch: string, prNumber: number) =>
    ['jenkins', 'pr', repoId, branch, prNumber] as const,
  jenkinsBuild: (buildUrl: string) => ['jenkins', 'build', buildUrl] as const,
  jenkinsTests: (buildUrl: string) => ['jenkins', 'tests', buildUrl] as const,
  jenkinsLog: (buildUrl: string) => ['jenkins', 'log', buildUrl] as const,
  vercelConfig: ['vercel', 'config'] as const,
  vercelStatus: ['vercel', 'status'] as const,
  vercelTeams: ['vercel', 'teams'] as const,
  vercelProjects: ['vercel', 'projects'] as const,
  vercelPRDeployments: (repoId: string, branch: string, headSha: string) =>
    ['vercel', 'pr', repoId, branch, headSha] as const
};
