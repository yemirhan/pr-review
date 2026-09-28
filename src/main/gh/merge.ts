import { gh } from './client';
import { invalidatePR } from './prs';
import type { MergeOptions, MergeStrategy } from '@shared/types';

const FLAG: Record<MergeStrategy, string> = {
  merge: '--merge',
  squash: '--squash',
  rebase: '--rebase'
};

export async function mergePR(
  owner: string,
  name: string,
  num: number,
  strategy: MergeStrategy,
  opts: MergeOptions = {}
): Promise<void> {
  const args = ['pr', 'merge', String(num), '--repo', `${owner}/${name}`, FLAG[strategy]];
  // --admin and --auto are mutually exclusive in gh; admin wins because it
  // is the explicit "merge now regardless" intent.
  if (opts.admin) args.push('--admin');
  else if (opts.auto) args.push('--auto');
  if (opts.deleteBranch) args.push('--delete-branch');
  try {
    await gh(args, { timeoutMs: 90_000 });
  } finally {
    invalidatePR(owner, name, num);
  }
}
