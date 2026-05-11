import { create } from 'zustand';
import type { DraftInlineComment, ReviewEvent } from '@shared/types';

interface DraftState {
  body: string;
  event: ReviewEvent;
  comments: DraftInlineComment[];
}

interface UIState {
  selectedRepoId: string | null;
  selectedPRNumber: number | null;
  drafts: Record<string, DraftState>; // key = `${repoId}:${prNumber}`

  selectRepo(id: string | null): void;
  selectPR(num: number | null): void;

  draftKey(): string | null;
  getDraft(): DraftState;
  setDraftBody(body: string): void;
  setDraftEvent(event: ReviewEvent): void;
  addDraftComment(c: DraftInlineComment): void;
  updateDraftComment(uid: string, body: string): void;
  removeDraftComment(uid: string): void;
  clearDraft(): void;
}

const EMPTY_DRAFT: DraftState = { body: '', event: 'COMMENT', comments: [] };

export const useUI = create<UIState>((set, get) => ({
  selectedRepoId: null,
  selectedPRNumber: null,
  drafts: {},

  selectRepo(id) {
    set({ selectedRepoId: id, selectedPRNumber: null });
  },
  selectPR(num) {
    set({ selectedPRNumber: num });
  },

  draftKey() {
    const { selectedRepoId, selectedPRNumber } = get();
    if (!selectedRepoId || selectedPRNumber == null) return null;
    return `${selectedRepoId}:${selectedPRNumber}`;
  },
  getDraft() {
    const key = get().draftKey();
    if (!key) return EMPTY_DRAFT;
    return get().drafts[key] ?? EMPTY_DRAFT;
  },
  setDraftBody(body) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => ({
      drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? EMPTY_DRAFT), body } }
    }));
  },
  setDraftEvent(event) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => ({
      drafts: { ...s.drafts, [key]: { ...(s.drafts[key] ?? EMPTY_DRAFT), event } }
    }));
  },
  addDraftComment(c) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: { ...s.drafts, [key]: { ...cur, comments: [...cur.comments, c] } }
      };
    });
  },
  updateDraftComment(uid, body) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...s.drafts,
          [key]: {
            ...cur,
            comments: cur.comments.map((c) => (c.uid === uid ? { ...c, body } : c))
          }
        }
      };
    });
  },
  removeDraftComment(uid) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...s.drafts,
          [key]: { ...cur, comments: cur.comments.filter((c) => c.uid !== uid) }
        }
      };
    });
  },
  clearDraft() {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const { [key]: _, ...rest } = s.drafts;
      return { drafts: rest };
    });
  }
}));
