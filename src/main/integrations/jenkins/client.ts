import type {
  GhError,
  JenkinsAuthResult,
  JenkinsBuild,
  JenkinsBuildDetail,
  JenkinsBuildResult,
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

function encodeBranch(branch: string): string {
  // Jenkins multibranch URL encodes branch as a single path segment;
  // slashes in the branch name become %2F.
  return encodeURIComponent(branch);
}

function branchJobUrl(
  cfg: JenkinsAuthedConfig,
  jobPath: string,
  branch: string
): string {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const path = jobPath.replace(/^\/+|\/+$/g, '');
  return `${base}/${path}/job/${encodeBranch(branch)}`;
}

async function call<T>(
  cfg: JenkinsAuthedConfig,
  url: string,
  init?: RequestInit & { expectJson?: boolean; crumb?: { name: string; value: string } | null }
): Promise<T> {
  const { expectJson = true, crumb, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        Authorization: basicAuth(cfg.username, cfg.apiToken),
        Accept: 'application/json',
        ...(crumb ? { [crumb.name]: crumb.value } : {}),
        ...(rest.headers ?? {})
      }
    });
  } catch (err) {
    throw new JenkinsClientError(
      'JENKINS_FAILED',
      `Network error contacting Jenkins: ${(err as Error).message}`
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new JenkinsClientError(
      'JENKINS_UNAUTHORIZED',
      'Jenkins rejected the credentials. Check username and API token in Settings.'
    );
  }
  if (res.status === 404) {
    throw new JenkinsClientError('JENKINS_NOT_FOUND', `Jenkins resource not found: ${url}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new JenkinsClientError(
      'JENKINS_FAILED',
      `Jenkins request failed (${res.status}): ${url}`,
      body
    );
  }
  if (!expectJson) return undefined as unknown as T;
  return (await res.json()) as T;
}

function mapResult(r: string | null, building: boolean): JenkinsBuildResult {
  if (building) return 'RUNNING';
  switch ((r ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'FAILURE':
      return 'FAILURE';
    case 'UNSTABLE':
      return 'UNSTABLE';
    case 'ABORTED':
      return 'ABORTED';
    case 'NOT_BUILT':
      return 'NOT_BUILT';
    default:
      return 'UNKNOWN';
  }
}

interface RawCause {
  shortDescription?: string;
}

interface RawAction {
  causes?: RawCause[];
  lastBuiltRevision?: { SHA1?: string };
  // build data action variant
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
  if (!actions) return null;
  for (const a of actions) {
    if (a.causes && a.causes.length > 0) {
      const c = a.causes.find((x) => x.shortDescription);
      if (c) return c.shortDescription ?? null;
    }
  }
  return null;
}

function pickSha(actions?: RawAction[]): string | null {
  if (!actions) return null;
  for (const a of actions) {
    if (a.lastBuiltRevision?.SHA1) return a.lastBuiltRevision.SHA1;
    if (a.buildsByBranchName) {
      for (const v of Object.values(a.buildsByBranchName)) {
        if (v.revision?.SHA1) return v.revision.SHA1;
      }
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
  const res = await call<{ fullName?: string; id?: string }>(
    cfg,
    `${cfg.baseUrl}/me/api/json?tree=fullName,id`
  );
  return { ok: true, user: res.fullName ?? res.id ?? cfg.username };
}

export async function listBuilds(
  cfg: JenkinsAuthedConfig,
  jobPath: string,
  branch: string,
  limit = 20
): Promise<JenkinsBuild[]> {
  const url =
    `${branchJobUrl(cfg, jobPath, branch)}/api/json` +
    `?tree=builds[${BUILD_TREE}]{0,${Math.max(1, limit)}}`;
  const raw = await call<{ builds?: RawBuild[] }>(cfg, url);
  return (raw.builds ?? []).map(mapBuild);
}

interface RawStage {
  id: string;
  name: string;
  status: string;
  durationMillis: number;
}

interface RawWfDescribe {
  stages?: RawStage[];
}

export async function getBuild(
  cfg: JenkinsAuthedConfig,
  jobPath: string,
  branch: string,
  buildNumber: number
): Promise<JenkinsBuildDetail> {
  const base = `${branchJobUrl(cfg, jobPath, branch)}/${buildNumber}`;
  const raw = await call<RawBuild>(cfg, `${base}/api/json?tree=${BUILD_TREE}`);
  let stages: JenkinsStage[] = [];
  try {
    const wf = await call<RawWfDescribe>(cfg, `${base}/wfapi/describe`);
    stages = (wf.stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      status: mapResult(s.status, false),
      durationMs: s.durationMillis ?? 0
    }));
  } catch (err) {
    if (!(err instanceof JenkinsClientError) || err.code !== 'JENKINS_NOT_FOUND') {
      // Non-404 wfapi failures should not break the detail call; pipeline plugin
      // may simply be absent. Bubble up only auth errors.
      if (err instanceof JenkinsClientError && err.code === 'JENKINS_UNAUTHORIZED') throw err;
    }
  }
  return { ...mapBuild(raw), stages };
}

interface RawTestSuite {
  cases?: Array<{ className: string; name: string; status: string }>;
}
interface RawTestReport {
  failCount?: number;
  skipCount?: number;
  passCount?: number;
  suites?: RawTestSuite[];
}

export async function getTestReport(
  cfg: JenkinsAuthedConfig,
  jobPath: string,
  branch: string,
  buildNumber: number
): Promise<JenkinsTestSummary | null> {
  const url = `${branchJobUrl(cfg, jobPath, branch)}/${buildNumber}/testReport/api/json?tree=failCount,skipCount,passCount,suites[cases[className,name,status]]`;
  try {
    const raw = await call<RawTestReport>(cfg, url);
    const failures: { className: string; name: string }[] = [];
    for (const s of raw.suites ?? []) {
      for (const c of s.cases ?? []) {
        const st = (c.status ?? '').toUpperCase();
        if (st === 'FAILED' || st === 'REGRESSION') {
          failures.push({ className: c.className, name: c.name });
          if (failures.length >= 10) break;
        }
      }
      if (failures.length >= 10) break;
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

async function getCrumb(
  cfg: JenkinsAuthedConfig
): Promise<{ name: string; value: string } | null> {
  try {
    const c = await call<{ crumbRequestField: string; crumb: string }>(
      cfg,
      `${cfg.baseUrl}/crumbIssuer/api/json`
    );
    return { name: c.crumbRequestField, value: c.crumb };
  } catch (err) {
    // Many Jenkins setups disable CSRF protection or this endpoint returns 404
    // when no crumb is required. Only re-throw auth errors.
    if (err instanceof JenkinsClientError && err.code === 'JENKINS_UNAUTHORIZED') throw err;
    return null;
  }
}

async function postBuild(
  cfg: JenkinsAuthedConfig,
  url: string,
  crumb: { name: string; value: string } | null
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: basicAuth(cfg.username, cfg.apiToken)
  };
  if (crumb) headers[crumb.name] = crumb.value;
  return fetch(url, { method: 'POST', headers, redirect: 'manual' });
}

/**
 * Trigger a build on a multibranch branch job. Declarative pipelines with a
 * `parameters {}` block are technically parameterized and reject `/build` with
 * 400, so we transparently fall back to `/buildWithParameters` in that case —
 * Jenkins fills in defaults for any param the caller omits. On final failure
 * the response body is included in the thrown error so the user can see what
 * Jenkins actually rejected.
 */
export async function triggerBuild(
  cfg: JenkinsAuthedConfig,
  jobPath: string,
  branch: string
): Promise<void> {
  const crumb = await getCrumb(cfg);
  const base = branchJobUrl(cfg, jobPath, branch);
  let res: Response;
  try {
    res = await postBuild(cfg, `${base}/build?delay=0sec`, crumb);
  } catch (err) {
    throw new JenkinsClientError(
      'JENKINS_FAILED',
      `Network error contacting Jenkins: ${(err as Error).message}`
    );
  }
  if (res.status === 400) {
    try {
      res = await postBuild(cfg, `${base}/buildWithParameters?delay=0sec`, crumb);
    } catch (err) {
      throw new JenkinsClientError(
        'JENKINS_FAILED',
        `Network error contacting Jenkins: ${(err as Error).message}`
      );
    }
  }
  // Jenkins returns 201 for a queued build, sometimes 302 (redirect to queue
  // item) which `redirect: 'manual'` surfaces as an opaqueredirect / type 0.
  if (res.status === 201 || res.status === 200 || res.type === 'opaqueredirect') return;
  if (res.status === 401 || res.status === 403) {
    throw new JenkinsClientError(
      'JENKINS_UNAUTHORIZED',
      'Jenkins rejected the credentials when triggering a build.'
    );
  }
  if (res.status === 404) {
    throw new JenkinsClientError(
      'JENKINS_NOT_FOUND',
      `Branch job not found: ${base}. The multibranch indexer may not have picked up this branch yet.`
    );
  }
  const body = await res.text().catch(() => '');
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 300);
  throw new JenkinsClientError(
    'JENKINS_FAILED',
    `Jenkins refused to start the build (HTTP ${res.status}).${snippet ? ` ${snippet}` : ''}`,
    body
  );
}
