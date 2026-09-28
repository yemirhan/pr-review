import { useRef, useState } from 'react';

interface Options {
  width: number;
  min: number;
  max: number;
  /** +1 when dragging right grows the panel (left rail), -1 for a right rail. */
  direction: 1 | -1;
  onCommit(width: number): void;
}

/**
 * Drag-to-resize for a side panel. While dragging, the width is written
 * straight to the element once per animation frame — no React renders, no
 * store or localStorage writes. The final width is committed on release.
 */
export function usePanelResize<T extends HTMLElement>({ width, min, max, direction, onCommit }: Options) {
  const panelRef = useRef<T>(null);
  const [dragging, setDragging] = useState(false);

  function startResize(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const panel = panelRef.current;
    if (!panel) return;

    const startX = e.clientX;
    let next = width;
    let frame = 0;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      next = Math.max(min, Math.min(max, width + direction * (ev.clientX - startX)));
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          panel.style.width = `${next}px`;
        });
      }
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      panel.style.width = `${next}px`;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('is-resizing');
      setDragging(false);
      onCommit(next);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  return { panelRef, dragging, startResize };
}
