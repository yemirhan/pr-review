import Store from 'electron-store';
import type { JenkinsConfig, JenkinsRepoConfig } from '@shared/types';

const store = new Store<JenkinsConfig>({
  name: 'integrations.jenkins',
  defaults: { baseUrl: null, username: null, apiToken: null, repos: {} }
});

export function getConfig(): JenkinsConfig {
  return {
    baseUrl: store.get('baseUrl', null),
    username: store.get('username', null),
    apiToken: store.get('apiToken', null),
    repos: store.get('repos', {})
  };
}

export function setBaseUrl(url: string | null): void {
  const trimmed = url?.trim().replace(/\/+$/, '') ?? '';
  store.set('baseUrl', trimmed || null);
}

export function setCredentials(username: string | null, apiToken: string | null): void {
  store.set('username', username && username.trim() ? username.trim() : null);
  store.set('apiToken', apiToken && apiToken.trim() ? apiToken.trim() : null);
}

export function getRepoConfig(repoId: string): JenkinsRepoConfig | null {
  const repos = store.get('repos', {});
  return repos[repoId] ?? null;
}

export function setRepoConfig(repoId: string, cfg: JenkinsRepoConfig | null): void {
  const repos = { ...store.get('repos', {}) };
  const cleaned = (cfg?.pipelines ?? [])
    .map((p) => ({
      id: p.id,
      label: p.label.trim(),
      jobPath: p.jobPath.trim().replace(/^\/+|\/+$/g, '')
    }))
    .filter((p) => p.jobPath.length > 0);
  if (cleaned.length === 0) {
    delete repos[repoId];
  } else {
    repos[repoId] = { pipelines: cleaned };
  }
  store.set('repos', repos);
}

/** Returns config only if base URL + creds are all set. */
export function getAuthedConfig(): {
  baseUrl: string;
  username: string;
  apiToken: string;
  repos: Record<string, JenkinsRepoConfig>;
} | null {
  const c = getConfig();
  if (!c.baseUrl || !c.username || !c.apiToken) return null;
  return {
    baseUrl: c.baseUrl,
    username: c.username,
    apiToken: c.apiToken,
    repos: c.repos
  };
}
