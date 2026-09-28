import { useQuery } from '@tanstack/react-query';
import { api, qk, unwrap } from './api';
import type {
  JenkinsBuildResult,
  JenkinsPRBuilds,
  VercelDeploymentState,
  VercelPRDeployments
} from '@shared/types';

/**
 * Jenkins builds and Vercel deployments of a PR's branch. Both the header
 * chip and the Builds tab read these, so they share one fetch; they poll
 * quickly while anything is running and slowly otherwise.
 */

const FAST = 8_000;
const SLOW = 60_000;

export function useBuildIntegrations(repoId: string) {
  const jenkinsCfg = useQuery({
    queryKey: qk.jenkinsConfig,
    queryFn: () => unwrap(api.integrations.jenkins.getConfig()),
    staleTime: 60_000
  });
  const vercelCfg = useQuery({
    queryKey: qk.vercelConfig,
    queryFn: () => unwrap(api.integrations.vercel.getConfig()),
    staleTime: 60_000
  });
  const j = jenkinsCfg.data;
  const jenkinsConnected = !!j?.baseUrl && !!j.username && !!j.apiToken;
  const jenkinsPipelines = j?.repos[repoId]?.pipelines.length ?? 0;
  const vercelConnected = !!vercelCfg.data?.token;
  return {
    jenkinsConnected,
    jenkinsPipelines,
    jenkins: jenkinsConnected && jenkinsPipelines > 0,
    vercel: vercelConnected,
    any: (jenkinsConnected && jenkinsPipelines > 0) || vercelConnected
  };
}

export function isJenkinsActive(r: JenkinsBuildResult): boolean {
  return r === 'RUNNING';
}

export function isVercelActive(s: VercelDeploymentState): boolean {
  return s === 'BUILDING' || s === 'INITIALIZING' || s === 'QUEUED';
}

export function useJenkinsPRBuilds(repoId: string, branch: string, prNumber: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.jenkinsPRBuilds(repoId, branch, prNumber),
    queryFn: () => unwrap(api.integrations.jenkins.prBuilds(repoId, branch, prNumber)),
    enabled,
    staleTime: 5_000,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data as JenkinsPRBuilds | undefined;
      return d?.pipelines.some((p) => p.inQueue || p.builds[0]?.building) ? FAST : SLOW;
    }
  });
}

export function useVercelPRDeployments(repoId: string, branch: string, headSha: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.vercelPRDeployments(repoId, branch, headSha),
    queryFn: () => unwrap(api.integrations.vercel.prDeployments(repoId, branch, headSha)),
    enabled,
    staleTime: 5_000,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data as VercelPRDeployments | undefined;
      return d?.projects.some((p) => isVercelActive(p.latest.state)) ? FAST : SLOW;
    }
  });
}

export interface BuildSummary {
  total: number;
  failed: number;
  running: number;
  passed: number;
  loading: boolean;
}

/** Counts across both providers, for the latest build/deployment of each. */
export function useBuildSummary(
  repoId: string,
  branch: string,
  prNumber: number,
  headSha: string
): BuildSummary & { available: boolean } {
  const integ = useBuildIntegrations(repoId);
  const jq = useJenkinsPRBuilds(repoId, branch, prNumber, integ.jenkins && !!branch);
  const vq = useVercelPRDeployments(repoId, branch, headSha, integ.vercel && !!branch && !!headSha);
  const s: BuildSummary = { total: 0, failed: 0, running: 0, passed: 0, loading: jq.isLoading || vq.isLoading };
  for (const p of jq.data?.pipelines ?? []) {
    const b = p.builds[0];
    if (!b && !p.inQueue) continue;
    s.total++;
    if (p.inQueue || b?.building) s.running++;
    else if (b?.result === 'SUCCESS') s.passed++;
    else if (b?.result === 'FAILURE' || b?.result === 'UNSTABLE') s.failed++;
  }
  for (const p of vq.data?.projects ?? []) {
    const st = p.latest.state;
    // Canceled deployments are usually skipped builds (no changes for that app).
    if (st === 'CANCELED') continue;
    s.total++;
    if (isVercelActive(st)) s.running++;
    else if (st === 'READY') s.passed++;
    else if (st === 'ERROR') s.failed++;
  }
  return { ...s, available: integ.any };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
