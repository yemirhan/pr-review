import { forwardRef, useEffect, useRef, useImperativeHandle } from 'react';

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  current: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export interface DiffSearchBarHandle {
  focus(): void;
}

export const DiffSearchBar = forwardRef<DiffSearchBarHandle, Props>(
  function DiffSearchBar(
    { query, onQueryChange, current, total, onNext, onPrev, onClose },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
      focus() {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }));

    useEffect(() => {
      // Focus on mount.
      inputRef.current?.focus();
    }, []);

    const empty = query.trim().length === 0;
    const noMatches = !empty && total === 0;

    return (
      <div className="flex items-center gap-2 px-3 h-9 border-b border-border-muted bg-canvas-inset/60">
        <SearchIcon />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search file names or code…"
          className={`flex-1 bg-transparent outline-none text-sm placeholder:text-fg-subtle ${
            noMatches ? 'text-danger' : 'text-fg'
          }`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <span className="text-2xs text-fg-subtle font-mono tabular-nums select-none">
          {empty ? '' : `${current}/${total}`}
        </span>
        <button
          onClick={onPrev}
          disabled={total === 0}
          className="btn-icon h-6 w-6 disabled:opacity-40"
          title="Previous match (Shift+Enter)"
          aria-label="Previous match"
        >
          <ChevronUp />
        </button>
        <button
          onClick={onNext}
          disabled={total === 0}
          className="btn-icon h-6 w-6 disabled:opacity-40"
          title="Next match (Enter)"
          aria-label="Next match"
        >
          <ChevronDown />
        </button>
        <button
          onClick={onClose}
          className="btn-icon h-6 w-6"
          title="Close (Esc)"
          aria-label="Close search"
        >
          <CloseIcon />
        </button>
      </div>
    );
  }
);

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10.3" y1="10.3" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function ChevronUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
