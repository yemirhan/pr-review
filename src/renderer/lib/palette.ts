import { create } from 'zustand';

/** Open state for the ⌘K command palette. Kept out of store/ui.ts on purpose. */
export const usePalette = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen(open) {
    set({ open });
  }
}));

export function openCommandPalette(): void {
  usePalette.getState().setOpen(true);
}
