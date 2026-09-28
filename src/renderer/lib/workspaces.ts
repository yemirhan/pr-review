import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap } from './api';

/** The PR's worktree (with live dirty/unpushed state), or null. */
export function useWorkspace(repoId: string | null | undefined, prNumber: number | null | undefined) {
  return useQuery({
    queryKey: repoId && prNumber != null ? qk.workspace(repoId, prNumber) : ['workspace', 'none'],
    queryFn: () => unwrap(api.workspaces.get(repoId!, prNumber!)),
    enabled: !!repoId && prNumber != null,
    staleTime: 15_000
  });
}

export function useInvalidateWorkspaces() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['workspace'] });
}
