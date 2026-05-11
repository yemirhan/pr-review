import { gh } from './client';
import type { MergeStrategy } from '@shared/types';

const FLAG: Record<MergeStrategy, string> = {
  merge: '--merge',
  squash: '--squash',
  rebase: '--rebase'
};

export async function mergePR(
  owner: string,
  name: string,
  num: number,
  strategy: MergeStrategy
): Promise<void> {
  await gh(['pr', 'merge', String(num), '--repo', `${owner}/${name}`, FLAG[strategy]]);
}
