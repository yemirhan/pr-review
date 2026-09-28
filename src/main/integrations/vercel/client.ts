import type {
  GhError,
  VercelAuthResult,
  VercelDeployment,
  VercelDeploymentState,
  VercelPRDeployments,
  VercelProjectDeployments,
  VercelProjectLookup,
  VercelTeam
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
      },
      signal: rest.signal ?? AbortSignal.timeout(30_000)
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
  name?: string;
  projectId?: string;
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
    githubOrg?: string;
    githubRepo?: string;
    githubCommitOrg?: string;
    githubCommitRepo?: string;
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

export async function listTeams(cfg: VercelAuthedConfig): Promise<VercelTeam[]> {
  // Teams are listed regardless of the configured team scope.
  const res = await call<{ teams?: Array<{ id: string; slug: string; name?: string }> }>(
    { ...cfg, teamId: null },
    '/v2/teams?limit=100'
  );
  return (res.teams ?? []).map((t) => ({ id: t.id, slug: t.slug, name: t.name || t.slug }));
}

interface RawProject {
  id: string;
  name: string;
  framework?: string | null;
  rootDirectory?: string | null;
  link?: { type?: string; org?: string; repo?: string; repoOwner?: string; repoSlug?: string } | null;
}

let projectsCache: { key: string; at: number; projects: VercelProjectLookup[] } | null = null;

/** Every project in the account/team, with the Git repo it's linked to. */
export async function listProjects(cfg: VercelAuthedConfig, fresh = false): Promise<VercelProjectLookup[]> {
  const key = `${cfg.teamId ?? ''}|${cfg.token.slice(-6)}`;
  if (!fresh && projectsCache?.key === key && Date.now() - projectsCache.at < 5 * 60_000) {
    return projectsCache.projects;
  }
  const out: VercelProjectLookup[] = [];
  let until: number | null = null;
  for (let page = 0; page < 20; page++) {
    const res: { projects?: RawProject[]; pagination?: { next?: number | null } } = await call(
      cfg,
      `/v9/projects?limit=100${until ? `&until=${until}` : ''}`
    );
    for (const p of res.projects ?? []) {
      const owner = p.link?.org ?? p.link?.repoOwner;
      const repo = p.link?.repo ?? p.link?.repoSlug;
      out.push({
        id: p.id,
        name: p.name,
        framework: p.framework ?? null,
        repo: owner && repo ? `${owner}/${repo}` : null,
        rootDirectory: p.rootDirectory ?? null
      });
    }
    until = res.pagination?.next ?? null;
    if (!until) break;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  projectsCache = { key, at: Date.now(), projects: out };
  return out;
}

function isInProgress(s: VercelDeploymentState): boolean {
  return s === 'BUILDING' || s === 'INITIALIZING' || s === 'QUEUED';
}

/**
 * Deployments of a PR's branch across every project linked to the repo, in
 * one request: Vercel filters by branch server-side, then deployments are
 * grouped per project, preferring the one for the PR's head commit.
 */
export async function prDeployments(
  cfg: VercelAuthedConfig,
  input: { owner: string; name: string; branch: string; headSha: string; hidden: string[] }
): Promise<VercelPRDeployments> {
  const res = await call<{ deployments?: RawDeployment[] }>(
    cfg,
    `/v6/deployments?branch=${encodeURIComponent(input.branch)}&limit=100`
  );
  const owner = input.owner.toLowerCase();
  const name = input.name.toLowerCase();
  const byProject = new Map<string, { name: string; list: VercelDeployment[] }>();
  for (const raw of res.deployments ?? []) {
    const org = (raw.meta?.githubCommitOrg ?? raw.meta?.githubOrg ?? '').toLowerCase();
    const repo = (raw.meta?.githubCommitRepo ?? raw.meta?.githubRepo ?? '').toLowerCase();
    // Deployments from other repos can share a branch name.
    if (org && repo && (org !== owner || repo !== name)) continue;
    const pid = raw.projectId ?? raw.name ?? raw.uid;
    const entry = byProject.get(pid) ?? { name: raw.name ?? pid, list: [] };
    entry.list.push(mapDeployment(raw));
    byProject.set(pid, entry);
  }
  const hidden = new Set(input.hidden);
  let hiddenCount = 0;
  const projects: VercelProjectDeployments[] = [];
  for (const [projectId, { name: projectName, list }] of byProject) {
    if (hidden.has(projectId)) {
      hiddenCount++;
      continue;
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    const head = list.find((d) => d.commitSha === input.headSha);
    const latest = head ?? list[0];
    projects.push({ projectId, projectName, latest, atHead: !!head, history: list.slice(0, 10) });
  }
  const rank = (p: VercelProjectDeployments) =>
    p.latest.state === 'ERROR' ? 0 : isInProgress(p.latest.state) ? 1 : p.latest.state === 'READY' ? 2 : 3;
  projects.sort((a, b) => rank(a) - rank(b) || a.projectName.localeCompare(b.projectName));
  return { projects, hidden: hiddenCount };
}
