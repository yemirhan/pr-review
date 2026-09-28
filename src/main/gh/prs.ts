import { gh, ghJson } from './client';
import { cached, cacheKeys, invalidate } from './cache';
import { mapPatchToFileDiff } from '../diff/parse';
import type {
  PRSummary,
  PRDetail,
  FileDiff,
  InlineCommentThread,
  PRIssueComment,
  ChecksRollup,
  PRReviewSummary,
  PRCommit,
  PRListState,
  PRState
} from '@shared/types';

// Default max ages. Short enough that a manual refresh (which busts the
// cache anyway) or the mergeability poll sees fresh data, long enough to
// absorb bursts where the same PR is requested by several renderer queries
// at once. Callers that can tolerate older data (AI prompts) pass their own.
const TTL_LIST_MS = 30_000;
const TTL_DETAIL_MS = 4_000;
const TTL_FILES_MS = 60_000;
const TTL_COMMENTS_MS = 30_000;
const TTL_COUNTS_MS = 60_000;

/** Max ages used when assembling AI prompts — a slightly stale PR is fine there. */
export const AI_CONTEXT_MAX_AGE = { detail: 120_000, files: 300_000 } as const;

/** Forget everything cached for a PR (call after any mutation on it). */
export function invalidatePR(owner: string, name: string, num: number): void {
  invalidate(cacheKeys.pr(owner, name, num));
  invalidate(cacheKeys.list(owner, name));
  invalidate(`${cacheKeys.repo(owner, name)}counts`);
}

/** Forget cached lists/counts for a repo (e.g. after creating a PR). */
export function invalidateRepo(owner: string, name: string): void {
  invalidate(cacheKeys.repo(owner, name));
}

const PR_LIST_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'headRefName',
  'baseRefName',
  'createdAt',
  'updatedAt',
  'mergedAt',
  'closedAt',
  'state',
  'labels',
  'isDraft',
  'reviewDecision',
  'statusCheckRollup',
  'additions',
  'deletions',
  'changedFiles'
].join(',');

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'headRefName',
  'baseRefName',
  'createdAt',
  'updatedAt',
  'mergedAt',
  'closedAt',
  'state',
  'labels',
  'isDraft',
  'reviewDecision',
  'statusCheckRollup',
  'additions',
  'deletions',
  'changedFiles',
  'body',
  'commits',
  'reviews',
  'mergeable',
  'mergeStateStatus',
  'headRefOid'
].join(',');

interface RawCheckRollup {
  state?: string;
  status?: string;
  conclusion?: string;
  __typename?: string;
}

function summarizeChecks(rollup: RawCheckRollup[] | undefined): ChecksRollup {
  if (!rollup || rollup.length === 0) {
    return { total: 0, passed: 0, failed: 0, pending: 0, state: 'UNKNOWN' };
  }
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const c of rollup) {
    const s = (c.conclusion || c.state || c.status || '').toUpperCase();
    if (s === 'SUCCESS' || s === 'NEUTRAL' || s === 'SKIPPED') passed++;
    else if (
      s === 'FAILURE' ||
      s === 'CANCELLED' ||
      s === 'TIMED_OUT' ||
      s === 'ERROR' ||
      s === 'ACTION_REQUIRED' ||
      s === 'STARTUP_FAILURE'
    )
      failed++;
    else pending++;
  }
  const total = rollup.length;
  const state =
    failed > 0 ? 'FAILURE' : pending > 0 ? 'PENDING' : passed > 0 ? 'SUCCESS' : 'UNKNOWN';
  return { total, passed, failed, pending, state };
}

interface RawPRSummary {
  number: number;
  title: string;
  url: string;
  author: { login: string; name?: string };
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  state?: string;
  labels: { name: string; color: string }[];
  isDraft: boolean;
  reviewDecision: string;
  statusCheckRollup?: RawCheckRollup[];
  additions: number;
  deletions: number;
  changedFiles: number;
}

function mapSummary(raw: RawPRSummary): PRSummary {
  const stateUpper = (raw.state ?? '').toUpperCase();
  const state: PRState =
    stateUpper === 'MERGED' || raw.mergedAt
      ? 'MERGED'
      : stateUpper === 'CLOSED'
        ? 'CLOSED'
        : 'OPEN';
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: { login: raw.author?.login ?? 'unknown' },
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt ?? null,
    closedAt: raw.closedAt ?? null,
    state,
    labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    isDraft: raw.isDraft,
    reviewDecision: (raw.reviewDecision || 'NONE') as PRSummary['reviewDecision'],
    checks: summarizeChecks(raw.statusCheckRollup),
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles
  };
}

export async function listPRs(
  owner: string,
  name: string,
  state: PRListState = 'open',
  limit = 100
): Promise<PRSummary[]> {
  return cached(`${cacheKeys.list(owner, name)}${state}:${limit}`, TTL_LIST_MS, async () => {
    const raw = await ghJson<RawPRSummary[]>([
      'pr',
      'list',
      '--repo',
      `${owner}/${name}`,
      '--state',
      state,
      '--limit',
      String(limit),
      '--json',
      PR_LIST_FIELDS
    ]);
    return raw.map(mapSummary);
  });
}

/**
 * Open-PR counts for many repos in ONE GraphQL request. The sidebar used to
 * run a full `gh pr list` (100 PRs × status rollups) per repo just to show a
 * badge, which was the single biggest contributor to secondary rate limits.
 */
export async function getOpenPRCounts(
  repos: { id: string; owner: string; name: string }[]
): Promise<Record<string, number>> {
  if (repos.length === 0) return {};
  const key = `counts:${repos
    .map((r) => `${r.owner}/${r.name}`)
    .sort()
    .join(',')}`;
  return cached(key, TTL_COUNTS_MS, async () => {
    const parts = repos.map(
      (r, i) =>
        `r${i}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) { pullRequests(states: OPEN) { totalCount } }`
    );
    const query = `query { ${parts.join(' ')} }`;
    const res = await ghJson<{
      data?: Record<string, { pullRequests?: { totalCount?: number } } | null>;
      errors?: { message: string }[];
    }>(['api', 'graphql', '-f', `query=${query}`]);
    const out: Record<string, number> = {};
    repos.forEach((r, i) => {
      const node = res.data?.[`r${i}`];
      const n = node?.pullRequests?.totalCount;
      if (typeof n === 'number') out[r.id] = n;
    });
    return out;
  });
}

interface RawPRDetail extends RawPRSummary {
  body: string;
  commits: {
    oid: string;
    messageHeadline: string;
    authoredDate: string;
    authors: { login: string; name?: string }[];
  }[];
  reviews: {
    id: number | string;
    author: { login: string };
    state: string;
    body: string;
    submittedAt?: string;
  }[];
  mergeable: string | boolean | null;
  mergeStateStatus: string;
  headRefOid: string;
}

export async function getPR(
  owner: string,
  name: string,
  num: number,
  maxAgeMs = TTL_DETAIL_MS
): Promise<PRDetail> {
  return cached(`${cacheKeys.pr(owner, name, num)}detail`, maxAgeMs, () =>
    fetchPR(owner, name, num)
  );
}

async function fetchPR(owner: string, name: string, num: number): Promise<PRDetail> {
  const raw = await ghJson<RawPRDetail>([
    'pr',
    'view',
    String(num),
    '--repo',
    `${owner}/${name}`,
    '--json',
    PR_VIEW_FIELDS
  ]);
  const base = mapSummary(raw);
  const commits: PRCommit[] = (raw.commits ?? []).map((c) => ({
    oid: c.oid,
    messageHeadline: c.messageHeadline,
    authoredDate: c.authoredDate,
    author: { login: c.authors?.[0]?.login ?? 'unknown' }
  }));
  const reviews: PRReviewSummary[] = (raw.reviews ?? []).map((r) => ({
    id: r.id,
    author: { login: r.author?.login ?? 'unknown' },
    state: (r.state as PRReviewSummary['state']) || 'COMMENTED',
    body: r.body ?? '',
    submittedAt: r.submittedAt
  }));
  const mergeableFlag =
    typeof raw.mergeable === 'boolean'
      ? raw.mergeable
      : raw.mergeable === 'MERGEABLE'
        ? true
        : raw.mergeable === 'CONFLICTING'
          ? false
          : null;
  return {
    ...base,
    body: raw.body ?? '',
    commits,
    reviews,
    mergeable: mergeableFlag,
    mergeStateStatus: raw.mergeStateStatus ?? '',
    headRefOid: raw.headRefOid
  };
}

interface RawFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function getFiles(
  owner: string,
  name: string,
  num: number,
  maxAgeMs = TTL_FILES_MS
): Promise<FileDiff[]> {
  return cached(`${cacheKeys.pr(owner, name, num)}files`, maxAgeMs, async () => {
    const raw = await ghJson<RawFile[]>(
      [
        'api',
        `repos/${owner}/${name}/pulls/${num}/files?per_page=100`,
        '--paginate',
        '--slurp'
      ],
      { timeoutMs: 120_000 }
    ).then(flattenPages<RawFile>);
    return raw.map(mapPatchToFileDiff);
  });
}

/** `gh api --paginate --slurp` wraps each page in an outer array; flatten to one list. */
function flattenPages<T>(pages: unknown): T[] {
  if (!Array.isArray(pages)) return [];
  const out: T[] = [];
  for (const page of pages) {
    if (Array.isArray(page)) out.push(...(page as T[]));
    else if (page != null) out.push(page as T);
  }
  return out;
}

interface RawComment {
  id: number;
  path: string;
  line: number | null;
  start_line: number | null;
  side: 'LEFT' | 'RIGHT';
  user: { login: string };
  body: string;
  created_at: string;
  in_reply_to_id?: number;
}

export async function getComments(
  owner: string,
  name: string,
  num: number
): Promise<InlineCommentThread[]> {
  return cached(`${cacheKeys.pr(owner, name, num)}comments`, TTL_COMMENTS_MS, async () => {
    const raw = await ghJson<RawComment[]>([
      'api',
      `repos/${owner}/${name}/pulls/${num}/comments?per_page=100`,
      '--paginate',
      '--slurp'
    ]).then(flattenPages<RawComment>);
    return raw.map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line,
      startLine: c.start_line,
      side: c.side ?? 'RIGHT',
      user: { login: c.user?.login ?? 'unknown' },
      body: c.body,
      createdAt: c.created_at,
      inReplyToId: c.in_reply_to_id
    }));
  });
}

interface RawIssueComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

/** Top-level conversation comments (the ones that aren't attached to a diff line). */
export async function getIssueComments(
  owner: string,
  name: string,
  num: number
): Promise<PRIssueComment[]> {
  return cached(`${cacheKeys.pr(owner, name, num)}issue-comments`, TTL_COMMENTS_MS, async () => {
    const raw = await ghJson<RawIssueComment[]>([
      'api',
      `repos/${owner}/${name}/issues/${num}/comments?per_page=100`,
      '--paginate',
      '--slurp'
    ]).then(flattenPages<RawIssueComment>);
    return raw.map((c) => ({
      id: c.id,
      user: { login: c.user?.login ?? 'unknown' },
      body: c.body ?? '',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      url: c.html_url
    }));
  });
}

export { gh };
