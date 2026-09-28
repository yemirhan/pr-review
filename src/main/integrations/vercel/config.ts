import Store from 'electron-store';
import { encryptSecret, readSecret } from '../../secure/secret';
import type { VercelConfig } from '@shared/types';

const store = new Store<VercelConfig>({
  name: 'integrations.vercel',
  defaults: { token: null, teamId: null, hiddenProjects: [] }
});

export function getConfig(): VercelConfig {
  const hidden = store.get('hiddenProjects', []);
  return {
    token: readSecret(
      () => store.get('token', null),
      (v) => store.set('token', v)
    ),
    teamId: store.get('teamId', null),
    hiddenProjects: Array.isArray(hidden) ? hidden : []
  };
}

/** Same as getConfig() but without the token, for the renderer. */
export function getPublicConfig(): VercelConfig {
  const c = getConfig();
  return { ...c, token: c.token ? '••••' : null };
}

export function setToken(token: string | null): void {
  store.set('token', encryptSecret(token && token.trim() ? token.trim() : null));
}

export function setTeamId(teamId: string | null): void {
  store.set('teamId', teamId && teamId.trim() ? teamId.trim() : null);
}

export function setProjectHidden(projectId: string, hidden: boolean): void {
  const set = new Set(getConfig().hiddenProjects);
  if (hidden) set.add(projectId);
  else set.delete(projectId);
  store.set('hiddenProjects', [...set]);
}

export function getAuthedConfig(): { token: string; teamId: string | null; hiddenProjects: string[] } | null {
  const c = getConfig();
  if (!c.token) return null;
  return { token: c.token, teamId: c.teamId, hiddenProjects: c.hiddenProjects };
}
