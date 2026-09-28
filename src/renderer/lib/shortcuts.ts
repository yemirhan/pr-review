import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PRSummary } from '@shared/types';
import { api, qk } from './api';
import { useUI } from '../store/ui';
import { usePalette } from './palette';

/** How long a locally merged/closed PR stays hidden from the open list. */
export const LOCAL_CLOSE_GRACE_MS = 5 * 60_000;

/** Open PRs minus the ones we merged/closed here and GitHub hasn't caught up on. */
export function visibleOpenPRs(
  prs: PRSummary[],
  repoId: string,
  locallyClosed: Record<string, number>,
  now = Date.now()
): PRSummary[] {
  return prs.filter((pr) => {
    const closedAt = locallyClosed[`${repoId}:${pr.number}`];
    return !(closedAt && now - closedAt < LOCAL_CLOSE_GRACE_MS);
  });
}

/** True when keystrokes belong to a text field. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') != null;
}

/**
 * App-wide keyboard shortcuts. Mounted once in App.
 *  - ⌘K / Ctrl+K: command palette (toggle)
 *  - ⌘1…⌘9: jump to PR tab N (⌘9 = last)
 *  - ⌘W, ⌃Tab, ⌘⇧[ / ⌘⇧] (from the app menu): close / cycle tabs
 *  - Escape (review mode): back to the inbox (tabs stay open)
 *  - [ / ] (review mode): show the previous / next open PR in this tab
 */
export function useGlobalShortcuts(): void {
  const qc = useQueryClient();

  useEffect(
    () =>
      api.events.onMenuCommand((cmd) => {
        const ui = useUI.getState();
        if (cmd === 'next-tab') ui.cycleTab(1);
        else if (cmd === 'prev-tab') ui.cycleTab(-1);
        else if (cmd === 'close-tab' && ui.selectedRepoId && ui.selectedPRNumber != null) {
          ui.closeTab(ui.selectedRepoId, ui.selectedPRNumber);
        }
      }),
    []
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
        const ui = useUI.getState();
        if (ui.tabs.length === 0) return;
        const n = Number(e.key);
        const t = n === 9 ? ui.tabs[ui.tabs.length - 1] : ui.tabs[n - 1];
        if (!t) return;
        e.preventDefault();
        ui.openPR(t.repoId, t.prNumber);
        return;
      }

      // ⌘K works from anywhere, including text fields.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        const palette = usePalette.getState();
        if (palette.open) {
          e.preventDefault();
          palette.setOpen(false);
          return;
        }
        if (dialogOpen()) return;
        e.preventDefault();
        palette.setOpen(true);
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (dialogOpen()) return;

      const ui = useUI.getState();
      if (ui.settingsOpen) {
        // An open dropdown takes this Esc; it's still in the DOM at this point.
        if (e.key === 'Escape' && !document.querySelector('[data-radix-popper-content-wrapper]')) {
          e.preventDefault();
          ui.setSettingsOpen(false);
        }
        return;
      }
      if (ui.selectedPRNumber == null) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        ui.selectPR(null);
        return;
      }

      if (e.key === '[' || e.key === ']') {
        const repoId = ui.selectedRepoId;
        if (!repoId) return;
        const data = qc.getQueryData<PRSummary[]>(qk.prs(repoId, 'open'));
        if (!data || data.length === 0) return;
        const list = visibleOpenPRs(data, repoId, ui.locallyClosed);
        if (list.length === 0) return;
        const idx = list.findIndex((p) => p.number === ui.selectedPRNumber);
        let next: number;
        if (idx === -1) next = e.key === ']' ? 0 : list.length - 1;
        else next = idx + (e.key === ']' ? 1 : -1);
        if (next < 0 || next >= list.length) return;
        e.preventDefault();
        ui.replaceActivePR(list[next].number);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [qc]);
}
