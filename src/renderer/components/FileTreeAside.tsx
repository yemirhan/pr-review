import { useState, type ReactNode } from 'react';
import {
  useUI,
  FILE_TREE_WIDTH_MIN,
  FILE_TREE_WIDTH_MAX
} from '../store/ui';

interface Props {
  children: ReactNode;
}

/**
 * Collapsible + resizable left rail that wraps the file tree. When collapsed,
 * shows a thin vertical strip with a re-open button so the tree is reachable
 * from any width.
 */
export function FileTreeAside({ children }: Props) {
  const width = useUI((s) => s.fileTreeWidth);
  const setWidth = useUI((s) => s.setFileTreeWidth);
  const collapsed = useUI((s) => s.fileTreeCollapsed);
  const toggle = useUI((s) => s.toggleFileTree);
  const [dragging, setDragging] = useState(false);

  if (collapsed) {
    return (
      <aside className="w-7 shrink-0 border-r border-border-muted bg-canvas-subtle/30 flex flex-col items-center pt-2">
        <button
          onClick={toggle}
          className="btn-icon h-7 w-7"
          title="Show file tree"
          aria-label="Show file tree"
        >
          <ChevronRight />
        </button>
      </aside>
    );
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    function onMove(ev: PointerEvent) {
      setWidth(startW + (ev.clientX - startX));
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <aside
      className="relative shrink-0 border-r border-border-muted bg-canvas-subtle/30 flex flex-col min-h-0"
      style={{ width: `${width}px` }}
    >
      <div className="flex items-center justify-between px-2 h-7 border-b border-border-muted shrink-0">
        <span className="text-2xs uppercase tracking-wide text-fg-subtle">Files</span>
        <button
          onClick={toggle}
          className="btn-icon h-6 w-6"
          title="Hide file tree"
          aria-label="Hide file tree"
        >
          <ChevronLeft />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      <div
        onPointerDown={startResize}
        className="absolute right-0 top-0 bottom-0 w-1.5 translate-x-1/2 cursor-col-resize z-10 group"
        title={`Drag to resize (${FILE_TREE_WIDTH_MIN}–${FILE_TREE_WIDTH_MAX}px)`}
        role="separator"
        aria-orientation="vertical"
      >
        <div
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${
            dragging ? 'bg-accent w-0.5' : 'bg-transparent group-hover:bg-accent/60'
          }`}
        />
      </div>
    </aside>
  );
}

function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 4l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
