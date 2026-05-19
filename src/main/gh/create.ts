import { gh, ghJson } from './client';
import type { CreatePRInput } from '@shared/types';

export interface RepoMeta {
  defaultBranch: string;
}

interface RawBranch {
  name: string;
}

interface RawRepo {
  default_branch: string;
}

export async function getRepoMeta(owner: string, name: string): Promise<RepoMeta> {
  const raw = await ghJson<RawRepo>(['api', `repos/${owner}/${name}`]);
  return { defaultBranch: raw.default_branch };
}

export async function listBranches(owner: string, name: string): Promise<string[]> {
  const raw = await ghJson<RawBranch[]>([
    'api',
    `repos/${owner}/${name}/branches?per_page=100`,
    '--paginate'
  ]);
  return raw.map((b) => b.name);
}

/** Returns the newly created PR number. */
export async function createPR(
  owner: string,
  name: string,
  input: CreatePRInput
): Promise<number> {
  const args = [
    'pr',
    'create',
    '--repo',
    `${owner}/${name}`,
    '--base',
    input.base,
    '--head',
    input.head,
    '--title',
    input.title,
    '--body',
    input.body
  ];
  if (input.draft) args.push('--draft');
  const out = await gh(args);
  // gh prints the PR URL on the last non-empty line.
  const url = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  const m = url?.match(/\/pull\/(\d+)/);
  if (!m) throw new Error(`Could not parse PR number from gh output: ${out}`);
  return Number(m[1]);
}
