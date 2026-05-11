import { useEffect } from 'react';
import { useUI } from '../store/ui';

/**
 * Sync the renderer-side theme preference to the <html data-theme> attribute,
 * which drives the CSS variable swap in theme.css.
 *
 * Call once near the root (App.tsx).
 */
export function useTheme(): void {
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}
