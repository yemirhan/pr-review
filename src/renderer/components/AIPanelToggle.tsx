import { useUI } from '../store/ui';

export function AIPanelToggle() {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);
  return (
    <button
      onClick={toggle}
      className={`btn-icon no-drag ${collapsed ? '' : 'text-accent'}`}
      title={collapsed ? 'Show AI review panel' : 'Hide AI review panel'}
      aria-label="Toggle AI review panel"
      aria-pressed={!collapsed}
    >
      <SparkleIcon />
    </button>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5l1.4 3.6L13 6.5 9.4 7.9 8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5Z"
        fill="currentColor"
      />
      <path
        d="M12.5 10.5l.55 1.45L14.5 12.5l-1.45.55-.55 1.45-.55-1.45L10.5 12.5l1.45-.55.55-1.45Z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  );
}
