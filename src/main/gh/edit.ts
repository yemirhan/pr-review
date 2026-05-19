import { gh } from './client';

export async function editPRTitle(
  owner: string,
  name: string,
  num: number,
  title: string
): Promise<void> {
  await gh(['pr', 'edit', String(num), '--repo', `${owner}/${name}`, '--title', title]);
}
