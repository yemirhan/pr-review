import { useMemo, useState, useRef, useEffect, memo } from 'react';
import type { FileDiff, DiffHunk, InlineCommentThread, DraftInlineComment } from '@shared/types';
import { highlightLines } from '../lib/highlight';
import { useUI } from '../store/ui';
import type { ApiError } from '../lib/api';

const LARGE_FILE_LINES = 1500;

interface Props {
  loading: boolean;
  error: ApiError | null;
  files: FileDiff[];
  threads: InlineCommentThread[];
}

export function DiffViewer({ loading, error, files, threads }: Props) {
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
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-3 space-y-3">
        {files.map((f) => (
          <FilePanel
            key={f.path}
            file={f}
            threads={threads.filter((t) => t.path === f.path)}
          />
        ))}
      </div>
    </div>
  );
}

const FilePanel = memo(function FilePanel({
  file,
  threads
}: {
  file: FileDiff;
  threads: InlineCommentThread[];
}) {
  const totalLines = file.hunks.reduce((acc, h) => acc + h.lines.length, 0);
  const [collapsed, setCollapsed] = useState(file.binary || totalLines > LARGE_FILE_LINES);

  return (
    <section className="rounded-md border border-border bg-canvas-subtle/40 overflow-hidden">
      <header
        className="flex items-center justify-between px-3 h-9 border-b border-border-muted bg-canvas-inset/50 cursor-pointer select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-fg-subtle text-xs">{collapsed ? '▸' : '▾'}</span>
          <code className="text-sm text-fg truncate">{file.path}</code>
          {file.oldPath && file.oldPath !== file.path && (
            <span className="text-2xs text-fg-subtle truncate">
              (was <code>{file.oldPath}</code>)
            </span>
          )}
          <StatusChip status={file.status} />
        </div>
        <div className="text-2xs shrink-0">
          <span className="text-success">+{file.additions}</span>{' '}
          <span className="text-danger">−{file.deletions}</span>
        </div>
      </header>
      {!collapsed && (
        <div>
          {file.binary ? (
            <div className="p-4 text-sm text-fg-muted">Binary file not shown.</div>
          ) : (
            <DiffBody file={file} threads={threads} />
          )}
        </div>
      )}
    </section>
  );
});

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
  /** Anchor index (where the drag started). */
  anchorIdx: number;
  /** Current head index (where the drag is now). */
  headIdx: number;
}

interface ComposerState {
  hunkIndex: number;
  startIdx: number;
  endIdx: number;
  body: string;
}

function DiffBody({ file, threads }: { file: FileDiff; threads: InlineCommentThread[] }) {
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

  // Precompute the full code blob for highlighting (one big string per file).
  const codeForHighlight = useMemo(() => {
    const all: string[] = [];
    file.hunks.forEach((h) => h.lines.forEach((l) => all.push(l.content)));
    return all.join('\n');
  }, [file.hunks]);

  const [tokens, setTokens] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (file.language === 'text' || codeForHighlight.length === 0) return;
    highlightLines(file.language, codeForHighlight)
      .then((t) => {
        if (!cancelled) setTokens(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file.language, codeForHighlight]);

  // Map (hunk, line) → global line index for token lookup.
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

  // Build a map for inline comment threads keyed by newSide line.
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

  // Draft comments keyed by line.
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

  // Global drag tracking: as the user moves the pointer after a +
  // pointer-down, extend the selection to the row under the cursor.
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
    e.preventDefault(); // suppress native text selection during drag
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
  onGutterPointerDown: (
    e: React.PointerEvent<HTMLElement>,
    hunkIndex: number,
    lineIndex: number
  ) => void;
}) {
  const bg =
    type === 'add' ? 'bg-diff-addBg' : type === 'del' ? 'bg-diff-delBg' : '';
  const sign = type === 'add' ? '+' : type === 'del' ? '−' : ' ';
  const signColor =
    type === 'add' ? 'text-success' : type === 'del' ? 'text-danger' : 'text-fg-subtle';

  const selOverlay = inSelection
    ? 'shadow-[inset_2px_0_0_theme(colors.accent.DEFAULT)] bg-accent-subtle/60'
    : '';

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
      <code
        className="flex-1 whitespace-pre pr-3 text-fg"
        dangerouslySetInnerHTML={
          tokenHtml ? { __html: tokenHtml } : undefined
        }
      >
        {tokenHtml ? undefined : content || ' '}
      </code>
    </div>
  );
});

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
