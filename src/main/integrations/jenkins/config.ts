import Store from 'electron-store';
import { encryptSecret, readSecret } from '../../secure/secret';
import type { JenkinsConfig, JenkinsRepoConfig } from '@shared/types';

const store = new Store<JenkinsConfig>({
  name: 'integrations.jenkins',
  defaults: { baseUrl: null, username: null, apiToken: null, repos: {} }
});

export function getConfig(): JenkinsConfig {
  return {
    baseUrl: store.get('baseUrl', null),
    username: store.get('username', null),
    apiToken: readSecret(
      () => store.get('apiToken', null),
      (v) => store.set('apiToken', v)
    ),
    repos: store.get('repos', {})
  };
}

/** Same as getConfig() but without the token, for the renderer. */
export function getPublicConfig(): JenkinsConfig {
  const c = getConfig();
  return { ...c, apiToken: c.apiToken ? '••••' : null };
}

export function setConnection(baseUrl: string | null, username: string | null, apiToken: string | null): void {
  const url = baseUrl?.trim().replace(/\/+$/, '') ?? '';
  store.set('baseUrl', url || null);
  store.set('username', username && username.trim() ? username.trim() : null);
  store.set('apiToken', encryptSecret(apiToken && apiToken.trim() ? apiToken.trim() : null));
}

export function getRepoConfig(repoId: string): JenkinsRepoConfig | null {
  return store.get('repos', {})[repoId] ?? null;
}

export function setRepoConfig(repoId: string, cfg: JenkinsRepoConfig | null): void {
  const repos = { ...store.get('repos', {}) };
  const seen = new Set<string>();
  const cleaned = (cfg?.pipelines ?? [])
    .map((p) => ({
      id: p.id,
      label: p.label.trim(),
      jobPath: p.jobPath.trim().replace(/^\/+|\/+$/g, '')
    }))
    .filter((p) => p.jobPath.length > 0 && !seen.has(p.jobPath) && !!seen.add(p.jobPath));
  if (cleaned.length === 0) delete repos[repoId];
  else repos[repoId] = { pipelines: cleaned };
  store.set('repos', repos);
}

/** Config only if base URL and credentials are all set. */
export function getAuthedConfig(): {
  baseUrl: string;
  username: string;
  apiToken: string;
  repos: Record<string, JenkinsRepoConfig>;
} | null {
  const c = getConfig();
  if (!c.baseUrl || !c.username || !c.apiToken) return null;
  return { baseUrl: c.baseUrl, username: c.username, apiToken: c.apiToken, repos: c.repos };
}
