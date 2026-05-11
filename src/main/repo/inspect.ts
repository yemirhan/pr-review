import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface RemoteInfo {
  owner: string;
  name: string;
}

/**
 * Read .git/config and extract github.com origin remote (owner, repo).
 * Supports https and ssh remote URL formats, with or without `.git` suffix.
 */
export async function inspectRepo(localPath: string): Promise<RemoteInfo> {
  const cfgPath = join(localPath, '.git', 'config');
  let cfg: string;
  try {
    cfg = await fs.readFile(cfgPath, 'utf8');
  } catch {
    // Maybe it's a worktree where .git is a file pointing elsewhere.
    const gitFile = join(localPath, '.git');
    const stat = await fs.stat(gitFile).catch(() => null);
    if (stat?.isFile()) {
      const content = await fs.readFile(gitFile, 'utf8');
      const m = content.match(/gitdir:\s*(.+)/);
      if (m) {
        const gitdir = m[1].trim();
        const altCfg = join(gitdir, 'config');
        cfg = await fs.readFile(altCfg, 'utf8');
      } else {
        throw new Error('NOT_A_GIT_REPO');
      }
    } else {
      throw new Error('NOT_A_GIT_REPO');
    }
  }

  // Find [remote "origin"] section, then its url = line.
  const sectionRe = /\[remote\s+"origin"\][^\[]*/g;
  const section = cfg.match(sectionRe)?.[0];
  if (!section) throw new Error('NOT_A_GITHUB_REMOTE');

  const urlMatch = section.match(/^\s*url\s*=\s*(.+)$/m);
  if (!urlMatch) throw new Error('NOT_A_GITHUB_REMOTE');

  const url = urlMatch[1].trim();
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error('NOT_A_GITHUB_REMOTE');
  return parsed;
}

export function parseGitHubUrl(url: string): RemoteInfo | null {
  // git@github.com:owner/repo(.git)
  const ssh = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], name: ssh[2] };

  // ssh://git@github.com/owner/repo(.git)
  const sshProto = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshProto) return { owner: sshProto[1], name: sshProto[2] };

  // https://github.com/owner/repo(.git)
  const https = url.match(/^https:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) return { owner: https[1], name: https[2] };

  return null;
}
