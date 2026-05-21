import type {
  GhError,
  VercelAuthResult,
  VercelDeployment,
  VercelDeploymentState,
  VercelProjectLookup
} from '@shared/types';

const BASE = 'https://api.vercel.com';

export class VercelClientError extends Error implements GhError {
  code: GhError['code'];
  stderr?: string;
  constructor(code: GhError['code'], message: string, stderr?: string) {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
  toJSON(): GhError {
    return { code: this.code, message: this.message, stderr: this.stderr };
  }
}

export interface VercelAuthedConfig {
  token: string;
  teamId: string | null;
}

function teamQuery(teamId: string | null): string {
  return teamId ? `teamId=${encodeURIComponent(teamId)}` : '';
}

async function call<T>(
  cfg: VercelAuthedConfig,
  path: string,
  init?: RequestInit & { extraQuery?: string }
): Promise<T> {
  const { extraQuery, ...rest } = init ?? {};
  const team = teamQuery(cfg.teamId);
  const sep = path.includes('?') ? '&' : '?';
  const query = [team, extraQuery].filter(Boolean).join('&');
  const url = `${BASE}${path}${query ? `${sep}${query}` : ''}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/json',
        ...(rest.headers ?? {})
      }
    });
  } catch (err) {
    throw new VercelClientError(
      'VERCEL_FAILED',
      `Network error contacting Vercel: ${(err as Error).message}`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new VercelClientError(
      'VERCEL_UNAUTHORIZED',
      'Vercel rejected the token. Check it (and the team id, if used) in Settings → Vercel.'
    );
  }
  if (res.status === 404) {
    throw new VercelClientError('VERCEL_NOT_FOUND', `Vercel resource not found: ${path}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new VercelClientError(
      'VERCEL_FAILED',
      `Vercel request failed (${res.status}): ${path}${snippet ? ` — ${snippet}` : ''}`,
      body
    );
  }
  return (await res.json()) as T;
}

function mapState(s: string | null | undefined): VercelDeploymentState {
  switch ((s ?? '').toUpperCase()) {
    case 'READY':
      return 'READY';
    case 'BUILDING':
      return 'BUILDING';
    case 'INITIALIZING':
      return 'INITIALIZING';
    case 'QUEUED':
      return 'QUEUED';
    case 'ERROR':
      return 'ERROR';
    case 'CANCELED':
    case 'CANCELLED':
      return 'CANCELED';
    default:
      return 'UNKNOWN';
  }
}

interface RawDeployment {
  uid: string;
  url: string;
  state?: string;
  readyState?: string;
  target?: 'preview' | 'production' | null;
  created: number;
  ready?: number;
  buildingAt?: number;
  inspectorUrl?: string | null;
  creator?: { username?: string; email?: string };
  meta?: {
    githubCommitRef?: string;
    githubCommitSha?: string;
    githubCommitMessage?: string;
    gitlabCommitRef?: string;
    gitlabCommitSha?: string;
    bitbucketCommitRef?: string;
    bitbucketCommitSha?: string;
    branch?: string;
  };
}

function pickBranch(meta: RawDeployment['meta']): string | null {
  return (
    meta?.githubCommitRef ??
    meta?.gitlabCommitRef ??
    meta?.bitbucketCommitRef ??
    meta?.branch ??
    null
  );
}

function pickSha(meta: RawDeployment['meta']): string | null {
  return meta?.githubCommitSha ?? meta?.gitlabCommitSha ?? meta?.bitbucketCommitSha ?? null;
}

function mapDeployment(d: RawDeployment): VercelDeployment {
  return {
    uid: d.uid,
    url: d.url,
    inspectorUrl: d.inspectorUrl ?? null,
    state: mapState(d.state ?? d.readyState),
    target: d.target ?? null,
    createdAt: d.created,
    readyAt: d.ready ?? null,
    buildingAt: d.buildingAt ?? null,
    branch: pickBranch(d.meta),
    commitSha: pickSha(d.meta),
    commitMessage: d.meta?.githubCommitMessage ?? null,
    creator: d.creator?.username ?? d.creator?.email ?? null
  };
}

export async function whoami(cfg: VercelAuthedConfig): Promise<VercelAuthResult> {
  // /v2/user requires no team scope; team token works fine here too.
  const res = await call<{ user?: { username?: string; email?: string; name?: string } }>(
    cfg,
    '/v2/user'
  );
  return {
    ok: true,
    user: res.user?.username ?? res.user?.name ?? res.user?.email ?? 'authenticated'
  };
}

export async function listProjects(
  cfg: VercelAuthedConfig
): Promise<VercelProjectLookup[]> {
  const res = await call<{ projects?: Array<{ id: string; name: string; framework?: string }> }>(
    cfg,
    '/v9/projects?limit=100'
  );
  return (res.projects ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    framework: p.framework ?? null
  }));
}

/**
 * List preview deployments for a project on a branch. Vercel's deployments
 * endpoint doesn't have a stable ref filter across providers, so we fetch the
 * most recent N preview deployments for the project and filter client-side by
 * the branch metadata.
 */
export async function listBranchDeployments(
  cfg: VercelAuthedConfig,
  projectId: string,
  branch: string,
  limit = 20
): Promise<VercelDeployment[]> {
  const res = await call<{ deployments?: RawDeployment[] }>(
    cfg,
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=preview&limit=${Math.min(100, Math.max(limit * 3, 30))}`
  );
  const all = (res.deployments ?? []).map(mapDeployment);
  const filtered = all.filter((d) => d.branch === branch);
  return filtered.slice(0, limit);
}
