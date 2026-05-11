import { gh, ghJson } from './client';
import { mapPatchToFileDiff } from '../diff/parse';
import type {
  PRSummary,
  PRDetail,
  FileDiff,
  InlineCommentThread,
  ChecksRollup,
  PRReviewSummary,
  PRCommit
} from '@shared/types';

const PR_LIST_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'headRefName',
  'baseRefName',
  'createdAt',
  'updatedAt',
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
    else if (s === 'FAILURE' || s === 'CANCELLED' || s === 'TIMED_OUT' || s === 'ERROR') failed++;
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
  labels: { name: string; color: string }[];
  isDraft: boolean;
  reviewDecision: string;
  statusCheckRollup?: RawCheckRollup[];
  additions: number;
  deletions: number;
  changedFiles: number;
}

function mapSummary(raw: RawPRSummary): PRSummary {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: { login: raw.author?.login ?? 'unknown' },
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    isDraft: raw.isDraft,
    reviewDecision: (raw.reviewDecision || 'NONE') as PRSummary['reviewDecision'],
    checks: summarizeChecks(raw.statusCheckRollup),
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles
  };
}

export async function listPRs(owner: string, name: string): Promise<PRSummary[]> {
  const raw = await ghJson<RawPRSummary[]>([
    'pr',
    'list',
    '--repo',
    `${owner}/${name}`,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    PR_LIST_FIELDS
  ]);
  return raw.map(mapSummary);
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

export async function getPR(owner: string, name: string, num: number): Promise<PRDetail> {
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

export async function getFiles(owner: string, name: string, num: number): Promise<FileDiff[]> {
  const raw = await ghJson<RawFile[]>([
    'api',
    `repos/${owner}/${name}/pulls/${num}/files`,
    '--paginate'
  ]);
  return raw.map(mapPatchToFileDiff);
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
  const raw = await ghJson<RawComment[]>([
    'api',
    `repos/${owner}/${name}/pulls/${num}/comments`,
    '--paginate'
  ]);
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
}

export { gh };
