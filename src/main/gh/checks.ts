import { ghJson } from './client';
import type { PRCheckRun, PRCheckBucket } from '@shared/types';

interface RawCheck {
  bucket?: string;
  completedAt?: string | null;
  description?: string | null;
  event?: string | null;
  link?: string | null;
  name?: string | null;
  startedAt?: string | null;
  state?: string | null;
  workflow?: string | null;
}

const BUCKETS = new Set<PRCheckBucket>([
  'pass',
  'fail',
  'pending',
  'skipping',
  'cancel'
]);

function normalizeBucket(b: string | undefined | null): PRCheckBucket {
  const v = (b ?? '').toLowerCase() as PRCheckBucket;
  return BUCKETS.has(v) ? v : 'pending';
}

export async function getChecks(
  owner: string,
  name: string,
  num: number
): Promise<PRCheckRun[]> {
  const raw = await ghJson<RawCheck[]>([
    'pr',
    'checks',
    String(num),
    '--repo',
    `${owner}/${name}`,
    '--json',
    'bucket,completedAt,description,event,link,name,startedAt,state,workflow'
  ]);
  return (raw ?? []).map((c) => ({
    name: c.name ?? '(unnamed)',
    workflow: c.workflow ?? null,
    state: c.state ?? null,
    bucket: normalizeBucket(c.bucket),
    link: c.link ?? null,
    startedAt: c.startedAt ?? null,
    completedAt: c.completedAt ?? null,
    description: c.description ?? null,
    event: c.event ?? null
  }));
}
