import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap } from './api';
import { useUI } from '../store/ui';
import type { AIReviewFinding, AISession, AISessionSummary } from '@shared/types';

/**
 * AI reviews live in the main process; the renderer mirrors them through
 * react-query. `useAISessionEvents` (mounted once in App) pushes every
 * update into the cache, so any component can read a PR's session.
 */
export function useAISessionEvents(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      api.events.onAISession((s) => {
        const prev = qc.getQueryData<AISession | null>(qk.aiSession(s.repoId, s.prNumber));
        if (prev?.status === 'running' && s.status !== 'running') {
          useUI.getState().markUnseen(s.repoId, s.prNumber);
        }
        qc.setQueryData(qk.aiSession(s.repoId, s.prNumber), s);
        qc.setQueryData<AISessionSummary[]>(qk.aiSessions, (old) => {
          const summary = summarize(s);
          const rest = (old ?? []).filter((x) => !(x.repoId === s.repoId && x.prNumber === s.prNumber));
          return [...rest, summary];
        });
      }),
    [qc]
  );
}

function summarize(s: AISession): AISessionSummary {
  return {
    repoId: s.repoId,
    prNumber: s.prNumber,
    headOid: s.headOid,
    status: s.status,
    findings: visibleFindings(s).length
  };
}

export function useAISession(repoId: string | null | undefined, prNumber: number | null | undefined) {
  return useQuery({
    queryKey: repoId && prNumber != null ? qk.aiSession(repoId, prNumber) : ['ai', 'session', 'none'],
    queryFn: () => unwrap(api.ai.session(repoId!, prNumber!)),
    enabled: !!repoId && prNumber != null,
    staleTime: Infinity
  });
}

/** Summaries keyed `${repoId}:${prNumber}` for list badges. */
export function useAISessionSummaries(): Map<string, AISessionSummary> {
  const q = useQuery({
    queryKey: qk.aiSessions,
    queryFn: () => unwrap(api.ai.sessions()),
    staleTime: Infinity
  });
  return useMemo(() => {
    const m = new Map<string, AISessionSummary>();
    for (const s of q.data ?? []) m.set(`${s.repoId}:${s.prNumber}`, s);
    return m;
  }, [q.data]);
}

export function visibleFindings(s: AISession | null | undefined): AIReviewFinding[] {
  if (!s) return [];
  return s.findings.filter((f) => !s.dismissed.includes(f.id));
}

/** Uid of the draft comment created from a finding. */
export const findingDraftUid = (findingId: string) => `ai-${findingId}`;
