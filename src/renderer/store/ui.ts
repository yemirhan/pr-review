import { create } from 'zustand';
import type { DraftFileComment, DraftInlineComment, ReviewEvent } from '@shared/types';

interface DraftState {
  body: string;
  event: ReviewEvent;
  comments: DraftInlineComment[];
  fileComments: DraftFileComment[];
}

export type Theme = 'dark' | 'light';

const THEME_KEY = 'pr-review:theme';
const COLLAPSE_KEY = 'pr-review:sidebarCollapsed';
const VIEWED_KEY = 'pr-review:viewed';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function readViewed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(VIEWED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeViewed(map: Record<string, boolean>) {
  try {
    localStorage.setItem(VIEWED_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/** Key for the viewed map. headOid is included so a new commit invalidates the flag. */
export function viewedKey(repoId: string, prNumber: number, headOid: string, path: string): string {
  return `${repoId}:${prNumber}:${headOid}:${path}`;
}

interface UIState {
  selectedRepoId: string | null;
  selectedPRNumber: number | null;
  drafts: Record<string, DraftState>; // key = `${repoId}:${prNumber}`

  theme: Theme;
  sidebarCollapsed: boolean;
  viewed: Record<string, boolean>;

  selectRepo(id: string | null): void;
  selectPR(num: number | null): void;

  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setViewed(key: string, viewed: boolean): void;

  draftKey(): string | null;
  getDraft(): DraftState;
  setDraftBody(body: string): void;
  setDraftEvent(event: ReviewEvent): void;
  addDraftComment(c: DraftInlineComment): void;
  updateDraftComment(uid: string, body: string): void;
  removeDraftComment(uid: string): void;
  addFileComment(c: DraftFileComment): void;
  updateFileComment(uid: string, body: string): void;
  removeFileComment(uid: string): void;
  clearDraft(): void;
}

const EMPTY_DRAFT: DraftState = { body: '', event: 'COMMENT', comments: [], fileComments: [] };

export const useUI = create<UIState>((set, get) => ({
  selectedRepoId: null,
  selectedPRNumber: null,
  drafts: {},

  theme: readTheme(),
  sidebarCollapsed: readCollapsed(),
  viewed: readViewed(),

  setTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore quota */
    }
    set({ theme });
  },
  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  setSidebarCollapsed(collapsed) {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore quota */
    }
    set({ sidebarCollapsed: collapsed });
  },
  toggleSidebar() {
    get().setSidebarCollapsed(!get().sidebarCollapsed);
  },
  setViewed(key, viewed) {
    set((s) => {
      const next = { ...s.viewed };
      if (viewed) next[key] = true;
      else delete next[key];
      writeViewed(next);
      return { viewed: next };
    });
  },

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
  addFileComment(c) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...s.drafts,
          [key]: { ...cur, fileComments: [...cur.fileComments, c] }
        }
      };
    });
  },
  updateFileComment(uid, body) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...s.drafts,
          [key]: {
            ...cur,
            fileComments: cur.fileComments.map((c) => (c.uid === uid ? { ...c, body } : c))
          }
        }
      };
    });
  },
  removeFileComment(uid) {
    const key = get().draftKey();
    if (!key) return;
    set((s) => {
      const cur = s.drafts[key] ?? EMPTY_DRAFT;
      return {
        drafts: {
          ...s.drafts,
          [key]: { ...cur, fileComments: cur.fileComments.filter((c) => c.uid !== uid) }
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
