import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap } from '../../lib/api';
import { findingDraftUid } from '../../lib/aiSessions';
import { useUI } from '../../store/ui';
import { findingCommentBody } from '@shared/review';
import type { AIReviewFinding, AISession } from '@shared/types';

/** Add-to-review / dismiss actions for AI findings of one PR. */
export function useFindingActions(repoId: string, prNumber: number) {
  const qc = useQueryClient();
  const draft = useUI((s) => s.getDraft());
  const addDraftComment = useUI((s) => s.addDraftComment);
  const removeDraftComment = useUI((s) => s.removeDraftComment);
  const addFileComment = useUI((s) => s.addFileComment);
  const removeFileComment = useUI((s) => s.removeFileComment);

  const addedIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of draft.comments) if (c.uid.startsWith('ai-')) set.add(c.uid.slice(3));
    for (const c of draft.fileComments) if (c.uid.startsWith('ai-')) set.add(c.uid.slice(3));
    return set;
  }, [draft.comments, draft.fileComments]);

  function add(f: AIReviewFinding) {
    if (addedIds.has(f.id)) return;
    if (f.anchored && f.line != null) {
      addDraftComment({
        uid: findingDraftUid(f.id),
        path: f.path,
        line: f.line,
        side: f.side,
        startLine: f.startLine,
        startSide: f.startLine != null ? f.side : undefined,
        body: findingCommentBody(f)
      });
    } else {
      addFileComment({ uid: findingDraftUid(f.id), path: f.path, body: findingCommentBody(f) });
    }
  }

  function remove(f: AIReviewFinding) {
    if (f.anchored) removeDraftComment(findingDraftUid(f.id));
    else removeFileComment(findingDraftUid(f.id));
  }

  async function setDismissed(f: AIReviewFinding, dismissed: boolean) {
    if (dismissed && addedIds.has(f.id)) remove(f);
    // Optimistic; the main process echoes the session back.
    qc.setQueryData<AISession | null>(qk.aiSession(repoId, prNumber), (s) =>
      s
        ? {
            ...s,
            dismissed: dismissed ? [...new Set([...s.dismissed, f.id])] : s.dismissed.filter((x) => x !== f.id)
          }
        : s
    );
    await unwrap(api.ai.dismiss(repoId, prNumber, f.id, dismissed)).catch(() => undefined);
  }

  return { addedIds, add, remove, setDismissed };
}
