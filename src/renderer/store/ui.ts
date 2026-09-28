import { create } from 'zustand';
import type { DraftFileComment, DraftInlineComment, ReviewEvent } from '@shared/types';

export type SettingsTab = 'general' | 'ai' | 'repos' | 'worktrees' | 'tools' | 'clickup' | 'jenkins' | 'vercel';

interface DraftState {
  body: string;
  event: ReviewEvent;
  comments: DraftInlineComment[];
  fileComments: DraftFileComment[];
}

export type Theme = 'dark' | 'light';
export type DiffDensity = 'compact' | 'comfortable';

const THEME_KEY = 'pr-review:theme';
const COLLAPSE_KEY = 'pr-review:sidebarCollapsed';
const AI_PANEL_KEY = 'pr-review:aiPanelCollapsed';
const VIEWED_KEY = 'pr-review:viewed';
const DIFF_FONT_SIZE_KEY = 'pr-review:diffFontSize';
const DIFF_DENSITY_KEY = 'pr-review:diffDensity';
const AI_PANEL_WIDTH_KEY = 'pr-review:aiPanelWidth';
const FILE_TREE_WIDTH_KEY = 'pr-review:fileTreeWidth';
const FILE_TREE_COLLAPSED_KEY = 'pr-review:fileTreeCollapsed';
const TABS_KEY = 'pr-review:tabs';

/** An open PR tab. */
export interface PRTab {
  repoId: string;
  prNumber: number;
}

export const tabKey = (repoId: string, prNumber: number) => `${repoId}:${prNumber}`;

function readTabs(): PRTab[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]') as PRTab[];
    return Array.isArray(raw)
      ? raw.filter((t) => typeof t?.repoId === 'string' && typeof t?.prNumber === 'number')
      : [];
  } catch {
    return [];
  }
}

function writeTabs(tabs: PRTab[]) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* ignore quota */
  }
}

export const DIFF_FONT_SIZE_MIN = 10;
export const DIFF_FONT_SIZE_MAX = 18;
export const DIFF_FONT_SIZE_DEFAULT = 12;

export const AI_PANEL_WIDTH_MIN = 320;
export const AI_PANEL_WIDTH_MAX = 1000;
export const AI_PANEL_WIDTH_DEFAULT = 380;

export const FILE_TREE_WIDTH_MIN = 160;
export const FILE_TREE_WIDTH_MAX = 560;
export const FILE_TREE_WIDTH_DEFAULT = 260;

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

function readAIPanelCollapsed(): boolean {
  try {
    const v = localStorage.getItem(AI_PANEL_KEY);
    // Default to collapsed — the panel is opt-in per session/PR.
    return v == null ? true : v === '1';
  } catch {
    return true;
  }
}

function readDiffFontSize(): number {
  try {
    const v = parseInt(localStorage.getItem(DIFF_FONT_SIZE_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= DIFF_FONT_SIZE_MIN && v <= DIFF_FONT_SIZE_MAX) return v;
  } catch {
    /* ignore */
  }
  return DIFF_FONT_SIZE_DEFAULT;
}

function readAIPanelWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(AI_PANEL_WIDTH_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= AI_PANEL_WIDTH_MIN && v <= AI_PANEL_WIDTH_MAX) return v;
  } catch {
    /* ignore */
  }
  return AI_PANEL_WIDTH_DEFAULT;
}

function readFileTreeWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(FILE_TREE_WIDTH_KEY) ?? '', 10);
    if (Number.isFinite(v) && v >= FILE_TREE_WIDTH_MIN && v <= FILE_TREE_WIDTH_MAX) return v;
  } catch {
    /* ignore */
  }
  return FILE_TREE_WIDTH_DEFAULT;
}

function readFileTreeCollapsed(): boolean {
  try {
    return localStorage.getItem(FILE_TREE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function readDiffDensity(): DiffDensity {
  try {
    const v = localStorage.getItem(DIFF_DENSITY_KEY);
    return v === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
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
  aiPanelCollapsed: boolean;
  viewed: Record<string, boolean>;
  /**
   * PRs we merged/closed from this app, keyed `${repoId}:${number}` with a
   * timestamp. GitHub's list endpoint lags a few seconds after a merge, so
   * the open list hides these until the server catches up.
   */
  locallyClosed: Record<string, number>;
  settingsOpen: boolean;
  /** Settings page to show when the dialog opens. */
  settingsTab: SettingsTab;
  diffFontSize: number;
  diffDensity: DiffDensity;
  aiPanelWidth: number;
  fileTreeWidth: number;
  fileTreeCollapsed: boolean;
  /** Finding the user asked the AI about; the panel scopes its composer to it. */
  aiAskFindingId: string | null;
  /** Open PR tabs, in order. The active one is selectedRepoId + selectedPRNumber. */
  tabs: PRTab[];
  /** Tabs whose AI review finished while they were in the background. */
  unseen: Record<string, true>;

  selectRepo(id: string | null): void;
  /** Open (and focus) a PR of the selected repo; null goes back to the inbox. */
  selectPR(num: number | null): void;
  /** Open a PR tab; `background` keeps the current view. */
  openPR(repoId: string, prNumber: number, opts?: { background?: boolean }): void;
  closeTab(repoId: string, prNumber: number): void;
  /** Point the active tab at another PR of the same repo (used by [ / ]). */
  replaceActivePR(prNumber: number): void;
  /** Activate the tab `delta` positions away, wrapping. */
  cycleTab(delta: number): void;
  markUnseen(repoId: string, prNumber: number): void;

  setTheme(theme: Theme): void;
  toggleTheme(): void;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  setAIPanelCollapsed(collapsed: boolean): void;
  toggleAIPanel(): void;
  setViewed(key: string, viewed: boolean): void;
  markLocallyClosed(repoId: string, prNumber: number): void;
  setSettingsOpen(open: boolean): void;
  openSettings(tab: SettingsTab): void;
  setSettingsTab(tab: SettingsTab): void;
  setDiffFontSize(size: number): void;
  setDiffDensity(density: DiffDensity): void;
  setAIPanelWidth(width: number): void;
  setFileTreeWidth(width: number): void;
  setFileTreeCollapsed(collapsed: boolean): void;
  toggleFileTree(): void;
  askAboutFinding(findingId: string | null): void;

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
  aiPanelCollapsed: readAIPanelCollapsed(),
  viewed: readViewed(),
  locallyClosed: {},
  settingsOpen: false,
  settingsTab: 'general',
  diffFontSize: readDiffFontSize(),
  diffDensity: readDiffDensity(),
  aiPanelWidth: readAIPanelWidth(),
  fileTreeWidth: readFileTreeWidth(),
  fileTreeCollapsed: readFileTreeCollapsed(),
  aiAskFindingId: null,
  tabs: readTabs(),
  unseen: {},

  askAboutFinding(findingId) {
    if (findingId) get().setAIPanelCollapsed(false);
    set({ aiAskFindingId: findingId });
  },

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
  setAIPanelCollapsed(collapsed) {
    try {
      localStorage.setItem(AI_PANEL_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore quota */
    }
    set({ aiPanelCollapsed: collapsed });
  },
  toggleAIPanel() {
    get().setAIPanelCollapsed(!get().aiPanelCollapsed);
  },
  openSettings(tab) {
    set({ settingsOpen: true, settingsTab: tab });
  },
  setSettingsTab(tab) {
    set({ settingsTab: tab });
  },
  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },
  setDiffFontSize(size) {
    const clamped = Math.max(DIFF_FONT_SIZE_MIN, Math.min(DIFF_FONT_SIZE_MAX, Math.round(size)));
    try {
      localStorage.setItem(DIFF_FONT_SIZE_KEY, String(clamped));
    } catch {
      /* ignore quota */
    }
    set({ diffFontSize: clamped });
  },
  setDiffDensity(density) {
    try {
      localStorage.setItem(DIFF_DENSITY_KEY, density);
    } catch {
      /* ignore quota */
    }
    set({ diffDensity: density });
  },
  setAIPanelWidth(width) {
    const clamped = Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, Math.round(width)));
    try {
      localStorage.setItem(AI_PANEL_WIDTH_KEY, String(clamped));
    } catch {
      /* ignore quota */
    }
    set({ aiPanelWidth: clamped });
  },
  setFileTreeWidth(width) {
    const clamped = Math.max(FILE_TREE_WIDTH_MIN, Math.min(FILE_TREE_WIDTH_MAX, Math.round(width)));
    try {
      localStorage.setItem(FILE_TREE_WIDTH_KEY, String(clamped));
    } catch {
      /* ignore quota */
    }
    set({ fileTreeWidth: clamped });
  },
  setFileTreeCollapsed(collapsed) {
    try {
      localStorage.setItem(FILE_TREE_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore quota */
    }
    set({ fileTreeCollapsed: collapsed });
  },
  toggleFileTree() {
    get().setFileTreeCollapsed(!get().fileTreeCollapsed);
  },
  markLocallyClosed(repoId, prNumber) {
    set((s) => ({ locallyClosed: { ...s.locallyClosed, [`${repoId}:${prNumber}`]: Date.now() } }));
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
    set({ selectedRepoId: id, selectedPRNumber: null, settingsOpen: false });
  },
  selectPR(num) {
    const repoId = get().selectedRepoId;
    if (num == null || !repoId) {
      set({ selectedPRNumber: null, aiAskFindingId: null, settingsOpen: false });
      return;
    }
    get().openPR(repoId, num);
  },
  openPR(repoId, prNumber, opts) {
    set((s) => {
      const key = tabKey(repoId, prNumber);
      const exists = s.tabs.some((t) => tabKey(t.repoId, t.prNumber) === key);
      let tabs = s.tabs;
      if (!exists) {
        // New tabs open right after the active one, like a browser.
        const activeIdx =
          s.selectedPRNumber != null && s.selectedRepoId
            ? s.tabs.findIndex((t) => tabKey(t.repoId, t.prNumber) === tabKey(s.selectedRepoId!, s.selectedPRNumber!))
            : -1;
        tabs = [...s.tabs];
        tabs.splice(activeIdx >= 0 ? activeIdx + 1 : tabs.length, 0, { repoId, prNumber });
        writeTabs(tabs);
      }
      if (opts?.background) return { tabs };
      const { [key]: _, ...unseen } = s.unseen;
      return {
        tabs,
        unseen,
        selectedRepoId: repoId,
        selectedPRNumber: prNumber,
        aiAskFindingId: null,
        settingsOpen: false
      };
    });
  },
  closeTab(repoId, prNumber) {
    set((s) => {
      const key = tabKey(repoId, prNumber);
      const idx = s.tabs.findIndex((t) => tabKey(t.repoId, t.prNumber) === key);
      if (idx < 0) return {};
      const tabs = s.tabs.filter((_, i) => i !== idx);
      writeTabs(tabs);
      const { [key]: _, ...unseen } = s.unseen;
      const active = s.selectedRepoId === repoId && s.selectedPRNumber === prNumber;
      if (!active) return { tabs, unseen };
      const next = tabs[idx] ?? tabs[idx - 1];
      return next
        ? { tabs, unseen, selectedRepoId: next.repoId, selectedPRNumber: next.prNumber, aiAskFindingId: null }
        : { tabs, unseen, selectedPRNumber: null, aiAskFindingId: null };
    });
  },
  replaceActivePR(prNumber) {
    set((s) => {
      const repoId = s.selectedRepoId;
      if (!repoId || s.selectedPRNumber == null) return {};
      const cur = tabKey(repoId, s.selectedPRNumber);
      const target = tabKey(repoId, prNumber);
      let tabs = s.tabs.some((t) => tabKey(t.repoId, t.prNumber) === target)
        ? s.tabs.filter((t) => tabKey(t.repoId, t.prNumber) !== cur)
        : s.tabs.map((t) => (tabKey(t.repoId, t.prNumber) === cur ? { repoId, prNumber } : t));
      if (tabs.length === 0) tabs = [{ repoId, prNumber }];
      writeTabs(tabs);
      return { tabs, selectedPRNumber: prNumber, aiAskFindingId: null };
    });
  },
  cycleTab(delta) {
    const s = get();
    if (s.tabs.length === 0) return;
    const idx =
      s.selectedPRNumber != null && s.selectedRepoId
        ? s.tabs.findIndex((t) => tabKey(t.repoId, t.prNumber) === tabKey(s.selectedRepoId!, s.selectedPRNumber!))
        : -1;
    const next = s.tabs[(((idx < 0 ? (delta > 0 ? -1 : 0) : idx) + delta) % s.tabs.length + s.tabs.length) % s.tabs.length];
    get().openPR(next.repoId, next.prNumber);
  },
  markUnseen(repoId, prNumber) {
    const s = get();
    if (s.selectedRepoId === repoId && s.selectedPRNumber === prNumber) return;
    set({ unseen: { ...s.unseen, [tabKey(repoId, prNumber)]: true } });
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
