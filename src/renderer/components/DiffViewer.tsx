import { useMemo, useState, useRef, useEffect, memo, forwardRef } from 'react';
import type {
  FileDiff,
  DiffHunk,
  InlineCommentThread,
  DraftInlineComment
} from '@shared/types';
import { highlightLines } from '../lib/highlight';
import { useUI, viewedKey } from '../store/ui';
import type { ApiError } from '../lib/api';
import { lineKey, type DiffMatch } from '../lib/diffSearch';

const LARGE_FILE_LINES = 1500;

interface Props {
  loading: boolean;
  error: ApiError | null;
  files: FileDiff[];
  threads: InlineCommentThread[];
  repoId: string;
  prNumber: number;
  headOid: string;
  /** Map of `${filePath}:${hunkIdx}:${lineIdx}` → ranges to highlight. */
  lineMatchMap?: Map<string, Array<{ start: number; end: number }>>;
  /** The currently-active match (gets a stronger highlight). */
  activeMatch?: DiffMatch;
  /** Files containing at least one match — auto-expand them. */
  filesWithMatches?: Set<string>;
}

export const DiffViewer = forwardRef<HTMLDivElement, Props>(function DiffViewer(
  {
    loading,
    error,
    files,
    threads,
    repoId,
    prNumber,
    headOid,
    lineMatchMap,
    activeMatch,
    filesWithMatches
  },
  ref
) {
  // Lift collapsed state up so external callers (search, file tree) can
  // expand a specific file imperatively.
  const [collapsedOverrides, setCollapsedOverrides] = useState<
    Map<string, boolean>
  >(new Map());

  // Reset overrides when the PR changes.
  useEffect(() => {
    setCollapsedOverrides(new Map());
  }, [repoId, prNumber, headOid]);

  // Auto-expand any file that currently has a search match.
  useEffect(() => {
    if (!filesWithMatches || filesWithMatches.size === 0) return;
    setCollapsedOverrides((cur) => {
      let changed = false;
      const next = new Map(cur);
      for (const path of filesWithMatches) {
        if (next.get(path) !== false) {
          next.set(path, false);
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [filesWithMatches]);

  function setFileCollapsed(path: string, collapsed: boolean) {
    setCollapsedOverrides((cur) => {
      const next = new Map(cur);
      next.set(path, collapsed);
      return next;
    });
  }

  if (loading) return <div className="p-6 text-fg-muted">Loading diff…</div>;
  if (error)
    return (
      <div className="p-6">
        <div className="text-danger bg-danger-subtle border border-danger-emphasis/40 rounded-md px-4 py-3 max-w-md">
          {error.message}
        </div>
      </div>
    );
  if (files.length === 0) return <div className="p-6 text-fg-muted">No file changes.</div>;

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-3 space-y-3">
        {files.map((f) => (
          <FilePanel
            key={f.path}
            file={f}
            threads={threads.filter((t) => t.path === f.path)}
            repoId={repoId}
            prNumber={prNumber}
            headOid={headOid}
            collapsedOverride={collapsedOverrides.get(f.path)}
            onCollapsedChange={(c) => setFileCollapsed(f.path, c)}
            lineMatchMap={lineMatchMap}
            activeMatch={activeMatch}
          />
        ))}
      </div>
    </div>
  );
});

const FilePanel = memo(function FilePanel({
  file,
  threads,
  repoId,
  prNumber,
  headOid,
  collapsedOverride,
  onCollapsedChange,
  lineMatchMap,
  activeMatch
}: {
  file: FileDiff;
  threads: InlineCommentThread[];
  repoId: string;
  prNumber: number;
  headOid: string;
  collapsedOverride: boolean | undefined;
  onCollapsedChange: (collapsed: boolean) => void;
  lineMatchMap?: Map<string, Array<{ start: number; end: number }>>;
  activeMatch?: DiffMatch;
}) {
  const totalLines = file.hunks.reduce((acc, h) => acc + h.lines.length, 0);

  const vKey = viewedKey(repoId, prNumber, headOid, file.path);
  const viewed = useUI((s) => !!s.viewed[vKey]);
  const setViewed = useUI((s) => s.setViewed);

  const defaultCollapsed =
    file.binary || totalLines > LARGE_FILE_LINES || viewed;
  const collapsed =
    collapsedOverride !== undefined ? collapsedOverride : defaultCollapsed;

  const [fileComposerOpen, setFileComposerOpen] = useState(false);
  const [fileComposerBody, setFileComposerBody] = useState('');

  const draft = useUI((s) => s.getDraft());
  const addFileComment = useUI((s) => s.addFileComment);
  const removeFileComment = useUI((s) => s.removeFileComment);

  const fileDrafts = useMemo(
    () => draft.fileComments.filter((c) => c.path === file.path),
    [draft.fileComments, file.path]
  );

  function onToggleViewed(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const next = e.target.checked;
    setViewed(vKey, next);
    if (next) onCollapsedChange(true);
  }

  function saveFileComment() {
    const body = fileComposerBody.trim();
    if (!body) return;
    addFileComment({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: file.path,
      body
    });
    setFileComposerBody('');
    setFileComposerOpen(false);
  }

  return (
    <section
      data-file-path={file.path}
      className={`rounded-md border border-border bg-canvas-subtle/40 transition-opacity ${
        viewed && collapsed ? 'opacity-70' : ''
      }`}
    >
      <header
        data-file-header={file.path}
        className={`sticky -top-px z-10 flex items-center justify-between px-3 h-10 border-b border-border-muted bg-canvas-inset/95 backdrop-blur supports-[backdrop-filter]:bg-canvas-inset/80 select-none gap-3 rounded-t-md ${
          collapsed ? 'rounded-b-md border-b-0' : ''
        }`}
      >
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <span className="text-fg-subtle text-xs">{collapsed ? '▸' : '▾'}</span>
          <code className={`text-sm truncate ${viewed ? 'text-fg-muted line-through' : 'text-fg'}`}>
            {file.path}
          </code>
          {file.oldPath && file.oldPath !== file.path && (
            <span className="text-2xs text-fg-subtle truncate">
              (was <code>{file.oldPath}</code>)
            </span>
          )}
          <StatusChip status={file.status} />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-2xs font-medium">
            <span className="text-success">+{file.additions}</span>{' '}
            <span className="text-danger">−{file.deletions}</span>
          </span>
          <DiffBar additions={file.additions} deletions={file.deletions} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFileComposerOpen((o) => !o);
              if (collapsed) onCollapsedChange(false);
            }}
            className={`btn-icon h-7 w-7 ${fileDrafts.length > 0 ? 'text-accent' : ''}`}
            title="Comment on this file"
            aria-label="Comment on this file"
          >
            <CommentIcon filled={fileDrafts.length > 0} />
          </button>
          <label
            className={`inline-flex items-center gap-1.5 h-7 px-2 rounded-lg border text-2xs font-medium cursor-pointer transition-colors duration-100 ${
              viewed
                ? 'bg-success-subtle border-success/40 text-success'
                : 'bg-canvas border-border text-fg-muted hover:text-fg'
            }`}
            onClick={(e) => e.stopPropagation()}
            title="Mark this file as viewed"
          >
            <input
              type="checkbox"
              checked={viewed}
              onChange={onToggleViewed}
              className="accent-success h-3 w-3"
            />
            Viewed
          </label>
        </div>
      </header>
      {!collapsed && (
        <div className="overflow-hidden rounded-b-md">
          {(fileDrafts.length > 0 || fileComposerOpen) && (
            <div className="px-3 pt-3 space-y-2 border-b border-border-muted pb-3 bg-canvas">
              {fileDrafts.map((d) => (
                <FileCommentBubble
                  key={d.uid}
                  body={d.body}
                  onRemove={() => removeFileComment(d.uid)}
                />
              ))}
              {fileComposerOpen && (
                <FileComposer
                  value={fileComposerBody}
                  onChange={setFileComposerBody}
                  onCancel={() => {
                    setFileComposerOpen(false);
                    setFileComposerBody('');
                  }}
                  onSave={saveFileComment}
                />
              )}
            </div>
          )}
          {file.binary ? (
            <div className="p-4 text-sm text-fg-muted">Binary file not shown.</div>
          ) : (
            <DiffBody
              file={file}
              threads={threads}
              lineMatchMap={lineMatchMap}
              activeMatch={activeMatch}
            />
          )}
        </div>
      )}
    </section>
  );
});

function DiffBar({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  if (total === 0) return null;
  const segments = 5;
  const addShare = Math.round((additions / total) * segments);
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {Array.from({ length: segments }).map((_, i) => {
        const cls =
          i < addShare
            ? 'bg-success'
            : i < addShare + (segments - addShare)
              ? 'bg-danger'
              : 'bg-border-muted';
        return <span key={i} className={`block h-2.5 w-2.5 rounded-sm ${cls}`} />;
      })}
    </span>
  );
}

function CommentIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11A1.5 1.5 0 0 1 15 5v6.5a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 2.5v-2.5h-1A1.5 1.5 0 0 1 1 11.5V5a1.5 1.5 0 0 1 1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.15 : 0}
      />
    </svg>
  );
}

function FileCommentBubble({ body, onRemove }: { body: string; onRemove: () => void }) {
  return (
    <div className="rounded-md border border-accent/40 bg-accent-subtle/40 px-3 py-2">
      <div className="flex items-center justify-between mb-1 text-2xs">
        <span className="text-accent font-medium">File-level draft</span>
        <button onClick={onRemove} className="text-fg-subtle hover:text-danger text-2xs">
          remove
        </button>
      </div>
      <div className="whitespace-pre-wrap text-fg text-xs">{body}</div>
    </div>
  );
}

function FileComposer({
  value,
  onChange,
  onCancel,
  onSave
}: {
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="rounded-md border border-accent/40 bg-canvas-overlay px-3 py-2 animate-slide-up">
      <div className="text-2xs text-accent mb-1 font-medium">Comment on this file</div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Add a file-level comment…"
        className="w-full bg-canvas-inset border border-border-muted rounded-md p-2 text-xs text-fg outline-none focus:border-accent resize-y"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (value.trim()) onSave();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-2xs text-fg-subtle">⌘+Enter to add · Esc to cancel</span>
        <div className="flex gap-1">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary disabled:opacity-50"
            disabled={!value.trim()}
            onClick={onSave}
          >
            Add to review
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: FileDiff['status'] }) {
  const map: Record<FileDiff['status'], string> = {
    added: 'border-success/40 text-success',
    removed: 'border-danger/40 text-danger',
    modified: 'border-border-muted text-fg-muted',
    renamed: 'border-attention/40 text-attention',
    copied: 'border-border-muted text-fg-muted',
    changed: 'border-border-muted text-fg-muted'
  };
  return <span className={`chip ${map[status]}`}>{status}</span>;
}

interface RowItem {
  kind: 'hunk-header' | 'line';
  hunkIndex: number;
  lineIndex?: number;
}

interface SelectionRange {
  hunkIndex: number;
  anchorIdx: number;
  headIdx: number;
}

interface ComposerState {
  hunkIndex: number;
  startIdx: number;
  endIdx: number;
  body: string;
}

function DiffBody({
  file,
  threads,
  lineMatchMap,
  activeMatch
}: {
  file: FileDiff;
  threads: InlineCommentThread[];
  lineMatchMap?: Map<string, Array<{ start: number; end: number }>>;
  activeMatch?: DiffMatch;
}) {
  const draft = useUI((s) => s.getDraft());
  const addDraftComment = useUI((s) => s.addDraftComment);
  const removeDraftComment = useUI((s) => s.removeDraftComment);

  const items = useMemo<RowItem[]>(() => {
    const rows: RowItem[] = [];
    file.hunks.forEach((h, hi) => {
      rows.push({ kind: 'hunk-header', hunkIndex: hi });
      h.lines.forEach((_, li) => rows.push({ kind: 'line', hunkIndex: hi, lineIndex: li }));
    });
    return rows;
  }, [file.hunks]);

  const codeForHighlight = useMemo(() => {
    const all: string[] = [];
    file.hunks.forEach((h) => h.lines.forEach((l) => all.push(l.content)));
    return all.join('\n');
  }, [file.hunks]);

  const themePref = useUI((s) => s.theme);
  const shikiTheme = themePref === 'light' ? 'github-light' : 'github-dark';

  const [tokens, setTokens] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (file.language === 'text' || codeForHighlight.length === 0) return;
    highlightLines(file.language, codeForHighlight, shikiTheme)
      .then((t) => {
        if (!cancelled) setTokens(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file.language, codeForHighlight, shikiTheme]);

  const lineGlobalIndex = useMemo(() => {
    const map: number[][] = [];
    let counter = 0;
    file.hunks.forEach((h, hi) => {
      map[hi] = [];
      h.lines.forEach((_, li) => {
        map[hi][li] = counter++;
      });
    });
    return map;
  }, [file.hunks]);

  const threadsByLine = useMemo(() => {
    const m = new Map<number, InlineCommentThread[]>();
    threads.forEach((t) => {
      if (t.line == null) return;
      const arr = m.get(t.line) ?? [];
      arr.push(t);
      m.set(t.line, arr);
    });
    return m;
  }, [threads]);

  const draftsByLine = useMemo(() => {
    const m = new Map<number, DraftInlineComment[]>();
    draft.comments
      .filter((c) => c.path === file.path)
      .forEach((c) => {
        const arr = m.get(c.line) ?? [];
        arr.push(c);
        m.set(c.line, arr);
      });
    return m;
  }, [draft.comments, file.path]);

  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [selecting, setSelecting] = useState<SelectionRange | null>(null);
  const lastClickRef = useRef<{ hunkIndex: number; lineIndex: number } | null>(null);

  useEffect(() => {
    if (!selecting) return;
    function move(e: PointerEvent) {
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const row = target?.closest('[data-hunk][data-line]') as HTMLElement | null;
      if (!row) return;
      const h = Number(row.dataset.hunk);
      const l = Number(row.dataset.line);
      setSelecting((cur) => {
        if (!cur || cur.hunkIndex !== h) return cur;
        if (cur.headIdx === l) return cur;
        return { ...cur, headIdx: l };
      });
    }
    function up() {
      setSelecting((cur) => {
        if (cur) {
          const start = Math.min(cur.anchorIdx, cur.headIdx);
          const end = Math.max(cur.anchorIdx, cur.headIdx);
          setComposer({ hunkIndex: cur.hunkIndex, startIdx: start, endIdx: end, body: '' });
        }
        return null;
      });
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [selecting]);

  function onGutterPointerDown(
    e: React.PointerEvent<HTMLElement>,
    hunkIndex: number,
    lineIndex: number
  ) {
    e.preventDefault();
    if (e.shiftKey && lastClickRef.current && lastClickRef.current.hunkIndex === hunkIndex) {
      const start = Math.min(lastClickRef.current.lineIndex, lineIndex);
      const end = Math.max(lastClickRef.current.lineIndex, lineIndex);
      setComposer({ hunkIndex, startIdx: start, endIdx: end, body: '' });
      return;
    }
    lastClickRef.current = { hunkIndex, lineIndex };
    setSelecting({ hunkIndex, anchorIdx: lineIndex, headIdx: lineIndex });
  }

  function saveComposer() {
    if (!composer) return;
    const h = file.hunks[composer.hunkIndex];
    const startLine = h.lines[composer.startIdx];
    const endLine = h.lines[composer.endIdx];
    const startNo = startLine.newNo ?? startLine.oldNo ?? 0;
    const endNo = endLine.newNo ?? endLine.oldNo ?? 0;
    const sideFor = (t: 'context' | 'add' | 'del'): 'LEFT' | 'RIGHT' =>
      t === 'del' ? 'LEFT' : 'RIGHT';
    const isRange = composer.startIdx !== composer.endIdx;
    addDraftComment({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: file.path,
      line: endNo,
      side: sideFor(endLine.type),
      startLine: isRange ? startNo : undefined,
      startSide: isRange ? sideFor(startLine.type) : undefined,
      body: composer.body.trim()
    });
    setComposer(null);
  }

  function isInSelection(hunkIndex: number, lineIndex: number): boolean {
    if (!selecting || selecting.hunkIndex !== hunkIndex) return false;
    const lo = Math.min(selecting.anchorIdx, selecting.headIdx);
    const hi = Math.max(selecting.anchorIdx, selecting.headIdx);
    return lineIndex >= lo && lineIndex <= hi;
  }

  return (
    <div
      className={`font-mono text-xs leading-5 ${selecting ? 'select-none cursor-row-resize' : ''}`}
    >
      <div className="bg-canvas">
        {items.map((it, idx) => {
          if (it.kind === 'hunk-header') {
            const h = file.hunks[it.hunkIndex];
            return (
              <div
                key={`h-${idx}`}
                className="flex items-center gap-2 px-2 h-5 text-fg-subtle bg-canvas-inset/40 border-y border-border-muted"
              >
                <code className="truncate">{h.header}</code>
              </div>
            );
          }
          const h = file.hunks[it.hunkIndex];
          const line = h.lines[it.lineIndex!];
          const globalIdx = lineGlobalIndex[it.hunkIndex][it.lineIndex!];
          const tokenHtml = tokens?.[globalIdx];
          const ln = line.newNo ?? line.oldNo ?? 0;
          const lineThreads = threadsByLine.get(ln) ?? [];
          const lineDrafts = draftsByLine.get(ln) ?? [];
          const composerOpen =
            composer?.hunkIndex === it.hunkIndex && composer?.endIdx === it.lineIndex;
          const inSel = isInSelection(it.hunkIndex, it.lineIndex!);

          const matchRanges =
            lineMatchMap?.get(lineKey(file.path, it.hunkIndex, it.lineIndex!));
          const isActiveLine =
            activeMatch?.kind === 'line' &&
            activeMatch.filePath === file.path &&
            activeMatch.hunkIndex === it.hunkIndex &&
            activeMatch.lineIndex === it.lineIndex;
          const activeRange = isActiveLine
            ? { start: activeMatch!.start, end: activeMatch!.end }
            : undefined;

          return (
            <div key={`l-${idx}`}>
              <DiffRow
                hunkIndex={it.hunkIndex}
                lineIndex={it.lineIndex!}
                type={line.type}
                oldNo={line.oldNo}
                newNo={line.newNo}
                content={line.content}
                tokenHtml={tokenHtml}
                inSelection={inSel}
                matchRanges={matchRanges}
                activeRange={activeRange}
                onGutterPointerDown={onGutterPointerDown}
              />
              {lineThreads.map((t) => (
                <CommentBubble
                  key={t.id}
                  author={t.user.login}
                  body={t.body}
                  date={t.createdAt}
                />
              ))}
              {lineDrafts.map((d) => (
                <CommentBubble
                  key={d.uid}
                  author="(draft)"
                  body={d.body}
                  rangeLabel={draftRangeLabel(d)}
                  onRemove={() => removeDraftComment(d.uid)}
                />
              ))}
              {composerOpen && (
                <Composer
                  rangeLabel={composerRangeLabel(file.hunks[composer!.hunkIndex], composer!)}
                  value={composer!.body}
                  onChange={(v) => setComposer((c) => (c ? { ...c, body: v } : c))}
                  onCancel={() => setComposer(null)}
                  onSave={saveComposer}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function composerRangeLabel(h: DiffHunk, c: ComposerState): string {
  const startLine = h.lines[c.startIdx];
  const endLine = h.lines[c.endIdx];
  const startNo = startLine.newNo ?? startLine.oldNo ?? 0;
  const endNo = endLine.newNo ?? endLine.oldNo ?? 0;
  if (c.startIdx === c.endIdx) return `line ${endNo}`;
  return `lines ${startNo}–${endNo}`;
}

function draftRangeLabel(d: DraftInlineComment): string | undefined {
  if (d.startLine != null && d.startLine !== d.line) {
    return `lines ${d.startLine}–${d.line}`;
  }
  return undefined;
}

const DiffRow = memo(function DiffRow({
  hunkIndex,
  lineIndex,
  type,
  oldNo,
  newNo,
  content,
  tokenHtml,
  inSelection,
  matchRanges,
  activeRange,
  onGutterPointerDown
}: {
  hunkIndex: number;
  lineIndex: number;
  type: 'context' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  content: string;
  tokenHtml: string | undefined;
  inSelection: boolean;
  matchRanges?: Array<{ start: number; end: number }>;
  activeRange?: { start: number; end: number };
  onGutterPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    hunkIndex: number,
    lineIndex: number
  ) => void;
}) {
  const bg = type === 'add' ? 'bg-diff-addBg' : type === 'del' ? 'bg-diff-delBg' : '';
  const sign = type === 'add' ? '+' : type === 'del' ? '−' : ' ';
  const signColor =
    type === 'add' ? 'text-success' : type === 'del' ? 'text-danger' : 'text-fg-subtle';

  const selOverlay = inSelection
    ? 'shadow-[inset_2px_0_0_theme(colors.accent.DEFAULT)] bg-accent-subtle/60'
    : '';

  const hasMatches = matchRanges && matchRanges.length > 0;
  // When the line has search matches, give up shiki highlighting on that line
  // so we can wrap the matched substrings cleanly. Most users won't care:
  // the active line is usually scrolled into view.
  const rendered = hasMatches ? (
    <HighlightedContent content={content} ranges={matchRanges} activeRange={activeRange} />
  ) : tokenHtml ? (
    <code
      className="flex-1 whitespace-pre pr-3 text-fg"
      dangerouslySetInnerHTML={{ __html: tokenHtml }}
    />
  ) : (
    <code className="flex-1 whitespace-pre pr-3 text-fg">{content || ' '}</code>
  );

  return (
    <div
      data-hunk={hunkIndex}
      data-line={lineIndex}
      className={`group flex items-stretch ${bg} ${selOverlay} hover:bg-canvas-overlay/40`}
    >
      <Gutter num={oldNo} variant="old" />
      <Gutter num={newNo} variant="new" />
      <button
        onPointerDown={(e) => onGutterPointerDown(e, hunkIndex, lineIndex)}
        className={`w-4 shrink-0 text-xs transition-opacity ${
          inSelection
            ? 'opacity-100 text-accent'
            : 'text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-accent'
        }`}
        title="Click to comment; drag to select a range; shift-click to extend"
        tabIndex={-1}
      >
        +
      </button>
      <span className={`w-3 shrink-0 ${signColor}`}>{sign}</span>
      {rendered}
    </div>
  );
});

function HighlightedContent({
  content,
  ranges,
  activeRange
}: {
  content: string;
  ranges: Array<{ start: number; end: number }> | undefined;
  activeRange?: { start: number; end: number };
}) {
  if (!ranges || ranges.length === 0) {
    return <code className="flex-1 whitespace-pre pr-3 text-fg">{content || ' '}</code>;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) {
      parts.push(content.slice(cursor, r.start));
    }
    const isActive =
      activeRange && activeRange.start === r.start && activeRange.end === r.end;
    parts.push(
      <mark
        key={i}
        className={
          isActive
            ? 'bg-attention text-canvas-inset rounded-sm px-px ring-1 ring-attention-emphasis'
            : 'bg-attention-subtle text-fg rounded-sm px-px'
        }
      >
        {content.slice(r.start, r.end)}
      </mark>
    );
    cursor = r.end;
  });
  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }
  return (
    <code className="flex-1 whitespace-pre pr-3 text-fg">
      {parts}
    </code>
  );
}

function Gutter({
  num,
  variant
}: {
  num: number | null;
  variant: 'old' | 'new';
}) {
  return (
    <span
      className={`w-10 shrink-0 text-right pr-2 text-fg-subtle bg-canvas-inset/40 border-r border-border-muted ${
        variant === 'old' ? 'border-l border-l-transparent' : ''
      }`}
    >
      {num ?? ''}
    </span>
  );
}

function CommentBubble({
  author,
  body,
  date,
  rangeLabel,
  onRemove
}: {
  author: string;
  body: string;
  date?: string;
  rangeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <div className="ml-24 my-1 rounded-md border border-border-muted bg-canvas-overlay px-3 py-2 max-w-2xl">
      <div className="flex items-center justify-between mb-1 text-2xs text-fg-subtle">
        <span>
          <span className="text-fg">@{author}</span>
          {rangeLabel && <> · <span className="text-accent">{rangeLabel}</span></>}
          {date && <> · {new Date(date).toLocaleString()}</>}
        </span>
        {onRemove && (
          <button onClick={onRemove} className="text-fg-subtle hover:text-danger text-2xs">
            remove
          </button>
        )}
      </div>
      <div className="whitespace-pre-wrap text-fg text-xs">{body}</div>
    </div>
  );
}

function Composer({
  rangeLabel,
  value,
  onChange,
  onCancel,
  onSave
}: {
  rangeLabel: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="ml-24 my-1 rounded-md border border-accent/40 bg-canvas-overlay px-3 py-2 max-w-2xl animate-slide-up">
      <div className="text-2xs text-accent mb-1">Comment on {rangeLabel}</div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Leave a comment…"
        className="w-full bg-canvas-inset border border-border-muted rounded-md p-2 text-xs text-fg outline-none focus:border-accent resize-y"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (value.trim()) onSave();
          }
          if (e.key === 'Escape') onCancel();
        }}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-2xs text-fg-subtle">⌘+Enter to add · Esc to cancel</span>
        <div className="flex gap-1">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn-primary disabled:opacity-50"
            disabled={!value.trim()}
            onClick={onSave}
          >
            Add to review
          </button>
        </div>
      </div>
    </div>
  );
}
