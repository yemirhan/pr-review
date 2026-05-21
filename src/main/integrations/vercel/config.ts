import Store from 'electron-store';
import type { VercelConfig, VercelRepoConfig } from '@shared/types';

const store = new Store<VercelConfig>({
  name: 'integrations.vercel',
  defaults: { token: null, teamId: null, repos: {} }
});

export function getConfig(): VercelConfig {
  return {
    token: store.get('token', null),
    teamId: store.get('teamId', null),
    repos: store.get('repos', {})
  };
}

export function setToken(token: string | null): void {
  store.set('token', token && token.trim() ? token.trim() : null);
}

export function setTeamId(teamId: string | null): void {
  store.set('teamId', teamId && teamId.trim() ? teamId.trim() : null);
}

export function setRepoConfig(repoId: string, cfg: VercelRepoConfig | null): void {
  const repos = { ...store.get('repos', {}) };
  const cleaned = (cfg?.projects ?? [])
    .map((p) => ({
      id: p.id,
      label: p.label.trim(),
      projectId: p.projectId.trim()
    }))
    .filter((p) => p.projectId.length > 0);
  if (cleaned.length === 0) {
    delete repos[repoId];
  } else {
    repos[repoId] = { projects: cleaned };
  }
  store.set('repos', repos);
}

export function getAuthedConfig(): {
  token: string;
  teamId: string | null;
  repos: Record<string, VercelRepoConfig>;
} | null {
  const c = getConfig();
  if (!c.token) return null;
  return { token: c.token, teamId: c.teamId, repos: c.repos };
}
