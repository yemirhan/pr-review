import { useUI } from '../store/ui';
import { ThemeToggle } from './ThemeToggle';

export function TitleBar() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const toggleSidebar = useUI((s) => s.toggleSidebar);

  return (
    <div className="drag h-10 shrink-0 flex items-center px-3 border-b border-border-muted bg-canvas-inset/60 select-none">
      <div className="w-20 flex items-center justify-start no-drag">
        {/* spacer for the macOS traffic lights (~70px) */}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
          PR Review
        </span>
      </div>
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={toggleSidebar}
          className="btn-icon"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label="Toggle sidebar"
        >
          {collapsed ? <PanelOpen /> : <PanelClose />}
        </button>
        <ThemeToggle />
      </div>
    </div>
  );
}

function PanelClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10 6l-2 2 2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelOpen() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 6l2 2-2 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
