import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiff } from '@shared/types';

export interface PathMatch {
  kind: 'path';
  filePath: string;
  /** Char offsets within the file path. */
  start: number;
  end: number;
}

export interface LineMatch {
  kind: 'line';
  filePath: string;
  hunkIndex: number;
  lineIndex: number;
  /** Char offsets within the line's content. */
  start: number;
  end: number;
}

export type DiffMatch = PathMatch | LineMatch;

export interface UseDiffSearchResult {
  query: string;
  setQuery: (q: string) => void;
  matches: DiffMatch[];
  /** Lookup by `${filePath}:${hunkIndex}:${lineIndex}` → ranges within line. */
  lineMatchMap: Map<string, Array<{ start: number; end: number }>>;
  /** Lookup by file path → ranges within the path. */
  pathMatchMap: Map<string, Array<{ start: number; end: number }>>;
  /** Set of file paths that contain at least one line OR path match. */
  filesWithMatches: Set<string>;
  current: number;
  total: number;
  next: () => void;
  prev: () => void;
  clear: () => void;
}

export function lineKey(filePath: string, hunkIdx: number, lineIdx: number): string {
  return `${filePath}:${hunkIdx}:${lineIdx}`;
}

function findAll(haystack: string, needle: string): Array<{ start: number; end: number }> {
  if (!needle) return [];
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= h.length) {
    const i = h.indexOf(n, from);
    if (i < 0) break;
    out.push({ start: i, end: i + n.length });
    from = i + Math.max(n.length, 1);
  }
  return out;
}

export function useDiffSearch(files: FileDiff[]): UseDiffSearchResult {
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);

  const { matches, lineMatchMap, pathMatchMap, filesWithMatches } = useMemo(() => {
    const empty = {
      matches: [] as DiffMatch[],
      lineMatchMap: new Map<string, Array<{ start: number; end: number }>>(),
      pathMatchMap: new Map<string, Array<{ start: number; end: number }>>(),
      filesWithMatches: new Set<string>()
    };
    if (query.trim().length === 0) return empty;
    const q = query;

    const all: DiffMatch[] = [];
    const lineMap = new Map<string, Array<{ start: number; end: number }>>();
    const pathMap = new Map<string, Array<{ start: number; end: number }>>();
    const withMatches = new Set<string>();

    for (const file of files) {
      const pathHits = findAll(file.path, q);
      if (pathHits.length > 0) {
        pathMap.set(file.path, pathHits);
        withMatches.add(file.path);
        for (const h of pathHits) {
          all.push({ kind: 'path', filePath: file.path, start: h.start, end: h.end });
        }
      }
      file.hunks.forEach((hunk, hi) => {
        hunk.lines.forEach((line, li) => {
          const hits = findAll(line.content, q);
          if (hits.length === 0) return;
          lineMap.set(lineKey(file.path, hi, li), hits);
          withMatches.add(file.path);
          for (const h of hits) {
            all.push({
              kind: 'line',
              filePath: file.path,
              hunkIndex: hi,
              lineIndex: li,
              start: h.start,
              end: h.end
            });
          }
        });
      });
    }

    return {
      matches: all,
      lineMatchMap: lineMap,
      pathMatchMap: pathMap,
      filesWithMatches: withMatches
    };
  }, [files, query]);

  // Reset current index whenever the query changes; clamp to in-range.
  useEffect(() => {
    setCurrent(0);
  }, [query]);
  useEffect(() => {
    if (current >= matches.length) setCurrent(0);
  }, [matches.length, current]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrent((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrent((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const clear = useCallback(() => {
    setQuery('');
    setCurrent(0);
  }, []);

  return {
    query,
    setQuery,
    matches,
    lineMatchMap,
    pathMatchMap,
    filesWithMatches,
    current: matches.length === 0 ? 0 : current + 1,
    total: matches.length,
    next,
    prev,
    clear
  };
}

/**
 * Track the active DiffMatch and scroll to it when it changes. Caller is
 * responsible for making sure the row/file is rendered (e.g. expanding a
 * collapsed file) before this fires.
 */
export function useScrollToMatch(
  match: DiffMatch | undefined,
  containerRef: React.RefObject<HTMLElement | null>
): void {
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!match) {
      lastKeyRef.current = null;
      return;
    }
    const key =
      match.kind === 'line'
        ? `line:${match.filePath}:${match.hunkIndex}:${match.lineIndex}:${match.start}`
        : `path:${match.filePath}:${match.start}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const container = containerRef.current;
    if (!container) return;

    // Try a few times — the target may not be in the DOM yet (file just
    // expanded, highlighter still loading, etc.).
    let attempts = 0;
    const headerSel = `[data-file-header="${cssEscape(match.filePath)}"]`;
    const rowSel =
      match.kind === 'line'
        ? `[data-file-path="${cssEscape(match.filePath)}"] [data-hunk="${match.hunkIndex}"][data-line="${match.lineIndex}"]`
        : null;
    function tryScroll() {
      const el = container!;
      // Diff rows render inside the diff library's Shadow DOM, so a row
      // selector usually won't match; fall back to the file header (the
      // matched line is highlighted via the library's selection instead).
      const row = rowSel ? (el.querySelector(rowSel) as HTMLElement | null) : null;
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
      const header = el.querySelector(headerSel) as HTMLElement | null;
      if (header) {
        header.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      attempts++;
      if (attempts < 10) setTimeout(tryScroll, 50);
    }
    tryScroll();
  }, [match, containerRef]);
}

function cssEscape(s: string): string {
  // Minimal escaping for use inside an attribute selector.
  return s.replace(/(["\\])/g, '\\$1');
}
