import Store from 'electron-store';
import type { ClickUpConfig, ClickUpRepoConfig } from '@shared/types';

const store = new Store<ClickUpConfig>({
  name: 'integrations.clickup',
  defaults: { apiToken: null, repos: {} }
});

export function getConfig(): ClickUpConfig {
  return {
    apiToken: store.get('apiToken', null),
    teamId: store.get('teamId', null),
    teams: store.get('teams', []),
    repos: store.get('repos', {})
  };
}

export function setApiToken(token: string | null): void {
  store.set('apiToken', token && token.trim() ? token.trim() : null);
}

export function getTeamId(): string | null {
  return store.get('teamId', null);
}

export function setTeamId(id: string | null): void {
  store.set('teamId', id);
}

export function setTeams(teams: { id: string; name: string }[]): void {
  store.set('teams', teams);
}

export function getRepoConfig(repoId: string): ClickUpRepoConfig {
  const repos = store.get('repos', {});
  return repos[repoId] ?? { statusMap: {} };
}

export function setRepoConfig(repoId: string, cfg: ClickUpRepoConfig): void {
  const repos = { ...store.get('repos', {}) };
  repos[repoId] = cfg;
  store.set('repos', repos);
}

export function getApiToken(): string | null {
  return store.get('apiToken', null);
}
