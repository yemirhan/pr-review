import { gh } from './client';
import { invalidatePR } from './prs';

export async function editPRTitle(
  owner: string,
  name: string,
  num: number,
  title: string
): Promise<void> {
  await gh(['pr', 'edit', String(num), '--repo', `${owner}/${name}`, '--title', title]);
  invalidatePR(owner, name, num);
}
