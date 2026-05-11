import Store from 'electron-store';
import { randomUUID } from 'node:crypto';
import type { Repo } from '@shared/types';

interface Schema {
  repos: Repo[];
}

const store = new Store<Schema>({
  name: 'config',
  defaults: { repos: [] }
});

export function listRepos(): Repo[] {
  return store.get('repos', []);
}

export function findRepo(id: string): Repo | undefined {
  return listRepos().find((r) => r.id === id);
}

export function addRepo(input: Omit<Repo, 'id' | 'addedAt' | 'label'>): Repo {
  const existing = listRepos().find(
    (r) => r.path === input.path || (r.owner === input.owner && r.name === input.name)
  );
  if (existing) return existing;

  const repos = listRepos();
  const dupNameCount = repos.filter((r) => r.name === input.name).length;
  const label = dupNameCount > 0 ? `${input.owner}/${input.name}` : input.name;

  const repo: Repo = {
    id: randomUUID(),
    addedAt: Date.now(),
    label,
    ...input
  };
  store.set('repos', [...repos, repo]);
  return repo;
}

export function removeRepo(id: string): void {
  store.set(
    'repos',
    listRepos().filter((r) => r.id !== id)
  );
}
