import type {
  GhError,
  JenkinsAuthResult,
  JenkinsBuild,
  JenkinsBuildDetail,
  JenkinsBuildResult,
  JenkinsJob,
  JenkinsPipelineBuilds,
  JenkinsPipelineConfig,
  JenkinsPRBuilds,
  JenkinsStage,
  JenkinsTestSummary
} from '@shared/types';

export class JenkinsClientError extends Error implements GhError {
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

export interface JenkinsAuthedConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
}

function basicAuth(username: string, token: string): string {
  return 'Basic ' + Buffer.from(`${username}:${token}`, 'utf8').toString('base64');
}

const trimSlashes = (s: string) => s.replace(/^\/+|\/+$/g, '');
const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`);

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** False for paths with broken %-escapes, which no Jenkins job can have. */
function isWellFormed(jobPath: string): boolean {
  try {
    trimSlashes(jobPath).split('/').forEach((seg) => decodeURIComponent(seg));
    return true;
  } catch {
    return false;
  }
}

/** Comparable form of a job path: segments decoded, no surrounding slashes. */
export function normalizeJobPath(jobPath: string): string {
  return trimSlashes(jobPath)
    .split('/')
    .map((seg) => safeDecode(seg))
    .join('/');
}

function jobUrl(cfg: JenkinsAuthedConfig, jobPath: string): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}/${trimSlashes(jobPath)}/`;
}

/**
 * URLs coming back from the renderer must point at the configured server, so
 * the credentials are never sent anywhere else.
 */
export function assertOwnUrl(cfg: JenkinsAuthedConfig, url: string): string {
  const base = new URL(withSlash(cfg.baseUrl));
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new JenkinsClientError('JENKINS_FAILED', `Not a Jenkins URL: ${url}`);
  }
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) {
    throw new JenkinsClientError('JENKINS_FAILED', `URL is not on ${cfg.baseUrl}: ${url}`);
  }
  return withSlash(u.toString());
}

async function request(
  cfg: JenkinsAuthedConfig,
  url: string,
  init?: RequestInit & { crumb?: { name: string; value: string } | null }
): Promise<Response> {
  const { crumb, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        Authorization: basicAuth(cfg.username, cfg.apiToken),
        Accept: 'application/json',
        ...(crumb ? { [crumb.name]: crumb.value } : {}),
        ...(rest.headers ?? {})
      },
      signal: rest.signal ?? AbortSignal.timeout(30_000)
    });
  } catch (err) {
    throw new JenkinsClientError(
      'JENKINS_FAILED',
      `Couldn't reach Jenkins: ${(err as Error).message}`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new JenkinsClientError(
      'JENKINS_UNAUTHORIZED',
      res.status === 401
        ? 'Jenkins rejected the username or API token.'
        : "Your Jenkins user doesn't have permission for this."
    );
  }
  if (res.status === 404) {
    throw new JenkinsClientError('JENKINS_NOT_FOUND', `Not found on Jenkins: ${url}`);
  }
  return res;
}

async function getJson<T>(cfg: JenkinsAuthedConfig, url: string): Promise<T> {
  const res = await request(cfg, url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JenkinsClientError('JENKINS_FAILED', `Jenkins request failed (${res.status}): ${url}`, body);
  }
  return (await res.json()) as T;
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

// --- builds -------------------------------------------------------------------

function mapResult(r: string | null, building: boolean): JenkinsBuildResult {
  if (building) return 'RUNNING';
  switch ((r ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
    case 'FAILED':
      return 'FAILURE';
    case 'UNSTABLE':
      return 'UNSTABLE';
    case 'ABORTED':
      return 'ABORTED';
    case 'NOT_BUILT':
    case 'NOT_EXECUTED':
      return 'NOT_BUILT';
    case 'IN_PROGRESS':
      return 'RUNNING';
    default:
      return 'UNKNOWN';
  }
}

interface RawAction {
  causes?: { shortDescription?: string }[];
  lastBuiltRevision?: { SHA1?: string };
  buildsByBranchName?: Record<string, { revision?: { SHA1?: string } }>;
}

interface RawBuild {
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  timestamp: number;
  duration: number;
  estimatedDuration?: number;
  actions?: RawAction[];
}

function pickCause(actions?: RawAction[]): string | null {
  for (const a of actions ?? []) {
    const c = a.causes?.find((x) => x.shortDescription);
    if (c) return c.shortDescription ?? null;
  }
  return null;
}

function pickSha(actions?: RawAction[]): string | null {
  for (const a of actions ?? []) {
    if (a.lastBuiltRevision?.SHA1) return a.lastBuiltRevision.SHA1;
    for (const v of Object.values(a.buildsByBranchName ?? {})) {
      if (v.revision?.SHA1) return v.revision.SHA1;
    }
  }
  return null;
}

function mapBuild(raw: RawBuild): JenkinsBuild {
  return {
    number: raw.number,
    url: raw.url,
    result: mapResult(raw.result, raw.building),
    building: raw.building,
    timestamp: raw.timestamp,
    duration: raw.duration,
    estimatedDuration: raw.estimatedDuration,
    cause: pickCause(raw.actions),
    commitSha: pickSha(raw.actions)
  };
}

const BUILD_TREE =
  'number,url,result,building,timestamp,duration,estimatedDuration,' +
  'actions[causes[shortDescription],lastBuiltRevision[SHA1],buildsByBranchName[revision[SHA1]]]';

export async function testAuth(cfg: JenkinsAuthedConfig): Promise<JenkinsAuthResult> {
  const res = await getJson<{ fullName?: string; id?: string }>(
    cfg,
    `${cfg.baseUrl.replace(/\/+$/, '')}/me/api/json?tree=fullName,id`
  );
  return { ok: true, user: res.fullName ?? res.id ?? cfg.username };
}

// --- discovery ------------------------------------------------------------------

const MULTIBRANCH = /WorkflowMultiBranchProject$/;
const FOLDER = /(\.Folder|OrganizationFolder)$/;

interface RawJob {
  _class?: string;
  name: string;
  displayName?: string;
  url: string;
}

function jobPathOf(cfg: JenkinsAuthedConfig, url: string): string {
  const base = new URL(withSlash(cfg.baseUrl)).pathname;
  const p = new URL(url).pathname;
  return trimSlashes(p.startsWith(base) ? p.slice(base.length) : p);
}

let jobsCache: { key: string; at: number; jobs: JenkinsJob[] } | null = null;

/** All multibranch pipelines on the server, walking folders up to 3 deep. */
export async function listJobs(cfg: JenkinsAuthedConfig, fresh = false): Promise<JenkinsJob[]> {
  const key = `${cfg.baseUrl}|${cfg.username}`;
  if (!fresh && jobsCache && jobsCache.key === key && Date.now() - jobsCache.at < 5 * 60_000) {
    return jobsCache.jobs;
  }
  const out: JenkinsJob[] = [];
  async function walk(url: string, folder: string[], depth: number): Promise<void> {
    const raw = await getJson<{ jobs?: RawJob[] }>(
      cfg,
      `${withSlash(url)}api/json?tree=jobs[_class,name,displayName,url]`
    );
    const folders: { url: string; name: string }[] = [];
    for (const j of raw.jobs ?? []) {
      const cls = j._class ?? '';
      if (MULTIBRANCH.test(cls)) {
        out.push({
          jobPath: jobPathOf(cfg, j.url),
          displayName: j.displayName || safeDecode(j.name),
          folder: folder.length ? folder.join(' / ') : null,
          url: withSlash(j.url)
        });
      } else if (FOLDER.test(cls) && depth < 3) {
        folders.push({ url: j.url, name: j.displayName || safeDecode(j.name) });
      }
    }
    await mapLimit(folders, 6, (f) => walk(f.url, [...folder, f.name], depth + 1));
  }
  await walk(cfg.baseUrl, [], 0);
  out.sort((a, b) =>
    `${a.folder ?? ''}/${a.displayName}`.localeCompare(`${b.folder ?? ''}/${b.displayName}`, undefined, {
      sensitivity: 'base'
    })
  );
  jobsCache = { key, at: Date.now(), jobs: out };
  return out;
}

/**
 * Best-effort: read each pipeline's config.xml to find the GitHub repo it
 * builds. Needs the "Extended Read" permission; jobs we can't read map to null.
 */
export async function detectJobRepos(
  cfg: JenkinsAuthedConfig,
  jobs: JenkinsJob[]
): Promise<Record<string, string | null>> {
  const pairs = await mapLimit(jobs, 6, async (j) => {
    try {
      const res = await request(cfg, `${j.url}config.xml`, { headers: { Accept: 'application/xml' } });
      if (!res.ok) return [j.jobPath, null] as const;
      return [j.jobPath, repoFromConfigXml(await res.text())] as const;
    } catch {
      return [j.jobPath, null] as const;
    }
  });
  return Object.fromEntries(pairs);
}

export function repoFromConfigXml(xml: string): string | null {
  const tag = (name: string) => xml.match(new RegExp(`<${name}>([^<]+)</${name}>`))?.[1]?.trim();
  const owner = tag('repoOwner');
  const repo = tag('repository');
  if (owner && repo) return `${owner}/${repo}`.toLowerCase();
  const remote = tag('remote') ?? tag('repositoryUrl') ?? tag('url');
  const m = remote?.match(/github\.com[/:]([^/]+)\/([^/.\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

// --- a PR's builds ----------------------------------------------------------------

interface RawBranchJob {
  name: string;
  displayName?: string;
  url: string;
}

/** Branch/PR jobs per pipeline, cached briefly so every PR doesn't rescan. */
const branchCache = new Map<string, { at: number; jobs: RawBranchJob[] }>();
const BRANCH_TTL = 60_000;

async function branchJobsOf(cfg: JenkinsAuthedConfig, jobPath: string, fresh: boolean): Promise<RawBranchJob[]> {
  const url = jobUrl(cfg, jobPath);
  const hit = branchCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < BRANCH_TTL) return hit.jobs;
  const raw = await getJson<{ jobs?: RawBranchJob[] }>(cfg, `${url}api/json?tree=jobs[name,displayName,url]`);
  const jobs = raw.jobs ?? [];
  branchCache.set(url, { at: Date.now(), jobs });
  return jobs;
}

/**
 * Multibranch jobs are named after the branch with `/` encoded (`feature%2Fx`),
 * and PRs discovered as change requests are named `PR-<n>`.
 */
function matchBranchJob(
  jobs: RawBranchJob[],
  branch: string,
  prNumber: number | null
): { job: RawBranchJob; kind: 'branch' | 'pr' } | null {
  const byBranch = jobs.find(
    (j) => j.name === branch || safeDecode(j.name) === branch || j.displayName === branch
  );
  if (byBranch) return { job: byBranch, kind: 'branch' };
  if (prNumber != null) {
    const pr = jobs.find((j) => j.name === `PR-${prNumber}`);
    if (pr) return { job: pr, kind: 'pr' };
  }
  return null;
}

export async function prBuilds(
  cfg: JenkinsAuthedConfig,
  pipelines: JenkinsPipelineConfig[],
  branch: string,
  prNumber: number | null,
  opts: { fresh?: boolean; limit?: number } = {}
): Promise<JenkinsPRBuilds> {
  const missing: string[] = [];
  const errors: { jobPath: string; message: string }[] = [];
  const found = await mapLimit(pipelines, 8, async (p): Promise<JenkinsPipelineBuilds | null> => {
    if (!isWellFormed(p.jobPath)) {
      missing.push(p.jobPath);
      return null;
    }
    let jobs: RawBranchJob[];
    try {
      jobs = await branchJobsOf(cfg, p.jobPath, !!opts.fresh);
    } catch (e) {
      if (e instanceof JenkinsClientError && e.code === 'JENKINS_NOT_FOUND') missing.push(p.jobPath);
      else if (e instanceof JenkinsClientError && e.code === 'JENKINS_UNAUTHORIZED') throw e;
      else errors.push({ jobPath: p.jobPath, message: (e as Error).message });
      return null;
    }
    const m = matchBranchJob(jobs, branch, prNumber);
    if (!m) return null;
    const url = withSlash(m.job.url);
    try {
      const raw = await getJson<{ builds?: RawBuild[]; inQueue?: boolean }>(
        cfg,
        `${url}api/json?tree=inQueue,builds[${BUILD_TREE}]{0,${opts.limit ?? 10}}`
      );
      return {
        jobPath: p.jobPath,
        label: p.label || prettyJobPath(p.jobPath),
        branchJobUrl: url,
        branchJobName: m.job.displayName || safeDecode(m.job.name),
        kind: m.kind,
        inQueue: !!raw.inQueue,
        builds: (raw.builds ?? []).map(mapBuild)
      };
    } catch (e) {
      if (e instanceof JenkinsClientError && e.code === 'JENKINS_NOT_FOUND') {
        branchCache.delete(jobUrl(cfg, p.jobPath));
        return null;
      }
      errors.push({ jobPath: p.jobPath, message: (e as Error).message });
      return null;
    }
  });
  return {
    pipelines: found.filter((x): x is JenkinsPipelineBuilds => x !== null),
    linked: pipelines.length,
    missing,
    errors
  };
}

export function prettyJobPath(raw: string): string {
  const names = trimSlashes(raw)
    .split('/')
    .filter((_, i) => i % 2 === 1);
  return names.length ? names.map(safeDecode).join(' / ') : raw;
}

// --- one build --------------------------------------------------------------------

interface RawStage {
  id: string;
  name: string;
  status: string;
  durationMillis: number;
}

export async function getBuild(cfg: JenkinsAuthedConfig, buildUrl: string): Promise<JenkinsBuildDetail> {
  const url = assertOwnUrl(cfg, buildUrl);
  const raw = await getJson<RawBuild>(cfg, `${url}api/json?tree=${BUILD_TREE}`);
  let stages: JenkinsStage[] = [];
  try {
    const wf = await getJson<{ stages?: RawStage[] }>(cfg, `${url}wfapi/describe`);
    stages = (wf.stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: mapResult(s.status, false),
      durationMs: s.durationMillis ?? 0
    }));
  } catch (err) {
    // The pipeline stage view plugin may be missing; only auth errors matter.
    if (err instanceof JenkinsClientError && err.code === 'JENKINS_UNAUTHORIZED') throw err;
  }
  return { ...mapBuild(raw), stages };
}

interface RawTestReport {
  failCount?: number;
  skipCount?: number;
  passCount?: number;
  suites?: { cases?: { className: string; name: string; status: string }[] }[];
}

export async function getTestReport(cfg: JenkinsAuthedConfig, buildUrl: string): Promise<JenkinsTestSummary | null> {
  const url = assertOwnUrl(cfg, buildUrl);
  try {
    const raw = await getJson<RawTestReport>(
      cfg,
      `${url}testReport/api/json?tree=failCount,skipCount,passCount,suites[cases[className,name,status]]`
    );
    const failures: { className: string; name: string }[] = [];
    outer: for (const s of raw.suites ?? []) {
      for (const c of s.cases ?? []) {
        const st = (c.status ?? '').toUpperCase();
        if (st === 'FAILED' || st === 'REGRESSION') {
          failures.push({ className: c.className, name: c.name });
          if (failures.length >= 20) break outer;
        }
      }
    }
    const failed = raw.failCount ?? failures.length;
    const skipped = raw.skipCount ?? 0;
    const passed = raw.passCount ?? 0;
    return { total: failed + skipped + passed, failed, skipped, passed, failures };
  } catch (err) {
    if (err instanceof JenkinsClientError && err.code === 'JENKINS_NOT_FOUND') return null;
    throw err;
  }
}

/** The last `maxLines` lines of a build's console output. */
export async function getLogTail(cfg: JenkinsAuthedConfig, buildUrl: string, maxLines = 120): Promise<string> {
  const url = assertOwnUrl(cfg, buildUrl);
  const res = await request(cfg, `${url}consoleText`, { headers: { Accept: 'text/plain' } });
  if (!res.ok) throw new JenkinsClientError('JENKINS_FAILED', `Couldn't load the build log (${res.status}).`);
  const text = (await res.text())
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(-maxLines).join('\n');
}

// --- actions ------------------------------------------------------------------------

async function getCrumb(cfg: JenkinsAuthedConfig): Promise<{ name: string; value: string } | null> {
  try {
    const c = await getJson<{ crumbRequestField: string; crumb: string }>(
      cfg,
      `${cfg.baseUrl.replace(/\/+$/, '')}/crumbIssuer/api/json`
    );
    return { name: c.crumbRequestField, value: c.crumb };
  } catch (err) {
    // CSRF protection may be off (404). Only auth errors matter.
    if (err instanceof JenkinsClientError && err.code === 'JENKINS_UNAUTHORIZED') throw err;
    return null;
  }
}

async function post(cfg: JenkinsAuthedConfig, url: string, crumb: { name: string; value: string } | null) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(cfg.username, cfg.apiToken),
        ...(crumb ? { [crumb.name]: crumb.value } : {})
      },
      redirect: 'manual'
    });
  } catch (err) {
    throw new JenkinsClientError('JENKINS_FAILED', `Couldn't reach Jenkins: ${(err as Error).message}`);
  }
}

/**
 * Queue a build of a branch job. Declarative pipelines with a `parameters {}`
 * block reject `/build` with 400, so fall back to `/buildWithParameters`
 * (Jenkins fills in the defaults).
 */
export async function triggerBuild(cfg: JenkinsAuthedConfig, branchJobUrl: string): Promise<void> {
  const url = assertOwnUrl(cfg, branchJobUrl);
  const crumb = await getCrumb(cfg);
  let res = await post(cfg, `${url}build?delay=0sec`, crumb);
  if (res.status === 400) res = await post(cfg, `${url}buildWithParameters?delay=0sec`, crumb);
  // 201 = queued; a 302 to the queue item shows up as an opaque redirect.
  if (res.status === 201 || res.status === 200 || res.type === 'opaqueredirect' || res.status === 302) return;
  await throwForAction(res, 'start the build');
}

export async function stopBuild(cfg: JenkinsAuthedConfig, buildUrl: string): Promise<void> {
  const url = assertOwnUrl(cfg, buildUrl);
  const crumb = await getCrumb(cfg);
  const res = await post(cfg, `${url}stop`, crumb);
  if (res.ok || res.type === 'opaqueredirect' || res.status === 302) return;
  await throwForAction(res, 'stop the build');
}

async function throwForAction(res: Response, what: string): Promise<never> {
  if (res.status === 401 || res.status === 403) {
    throw new JenkinsClientError('JENKINS_UNAUTHORIZED', `Jenkins didn't let you ${what} (HTTP ${res.status}).`);
  }
  const body = await res.text().catch(() => '');
  const snippet = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  throw new JenkinsClientError(
    'JENKINS_FAILED',
    `Jenkins couldn't ${what} (HTTP ${res.status}).${snippet ? ` ${snippet}` : ''}`,
    body
  );
}
