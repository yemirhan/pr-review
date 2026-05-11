import { useUI } from '../store/ui';

export function ThemeToggle() {
  const theme = useUI((s) => s.theme);
  const toggle = useUI((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggle}
      className="btn-icon no-drag"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle color theme"
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="1.4" x2="8" y2="3.2" />
        <line x1="8" y1="12.8" x2="8" y2="14.6" />
        <line x1="1.4" y1="8" x2="3.2" y2="8" />
        <line x1="12.8" y1="8" x2="14.6" y2="8" />
        <line x1="3.3" y1="3.3" x2="4.5" y2="4.5" />
        <line x1="11.5" y1="11.5" x2="12.7" y2="12.7" />
        <line x1="3.3" y1="12.7" x2="4.5" y2="11.5" />
        <line x1="11.5" y1="4.5" x2="12.7" y2="3.3" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13.2 9.5A5.4 5.4 0 0 1 6.5 2.8a.5.5 0 0 0-.7-.5 6.5 6.5 0 1 0 8 8 .5.5 0 0 0-.6-.8Z"
        fill="currentColor"
      />
    </svg>
  );
}
