import { useMemo, useState, useRef, useEffect, memo, forwardRef } from 'react';
import { PatchDiff } from '@pierre/diffs/react';
import type {
  AnnotationSide,
  DiffLineAnnotation,
  SelectedLineRange
} from '@pierre/diffs';
import type {
  AIReviewFinding,
  FileDiff,
  InlineCommentThread,
  DraftInlineComment
} from '@shared/types';
import { useUI, viewedKey } from '../store/ui';
import type { ApiError } from '../lib/api';
import type { DiffMatch } from '../lib/diffSearch';
import { Skeleton } from './ui/skeleton';
import { FindingInline } from './ai/FindingInline';

const LARGE_FILE_LINES = 1500;

/** A line to spotlight (e.g. from an AI finding). `nonce` re-triggers the same target. */
export interface DiffHighlight {
  path: string;
  line: number;
  startLine?: number;
  side: 'LEFT' | 'RIGHT';
  nonce: number;
}

interface Props {
  loading: boolean;
  error: ApiError | null;
  files: FileDiff[];
  threads: InlineCommentThread[];
  repoId: string;
  prNumber: number;
  headOid: string;
  /** The currently-active search match (its line gets the selection highlight). */
  activeMatch?: DiffMatch;
  /** Files containing at least one match — auto-expand them. */
  filesWithMatches?: Set<string>;
  /** External spotlight (jump-to-finding); expands the file and selects the range. */
  highlight?: DiffHighlight | null;
  /** AI findings to render inline (already filtered to visible ones). */
  findings?: AIReviewFinding[];
  /** No commenting, no viewed toggles (e.g. previewing AI-applied changes). */
  readOnly?: boolean;
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
    activeMatch,
    filesWithMatches,
    highlight,
    findings,
    readOnly
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

  // Force-expand the highlighted file so the spotlighted line can render.
  useEffect(() => {
    if (!highlight) return;
    setCollapsedOverrides((cur) => {
      if (cur.get(highlight.path) === false) return cur;
      const next = new Map(cur);
      next.set(highlight.path, false);
      return next;
    });
  }, [highlight]);

  function setFileCollapsed(path: string, collapsed: boolean) {
    setCollapsedOverrides((cur) => {
      const next = new Map(cur);
      next.set(path, collapsed);
      return next;
    });
  }

  if (loading) return <DiffViewerSkeleton />;
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
            activeMatch={activeMatch}
            highlight={highlight && highlight.path === f.path ? highlight : null}
            findings={findings?.filter((x) => x.path === f.path)}
            readOnly={readOnly}
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
  activeMatch,
  highlight,
  findings,
  readOnly
}: {
  file: FileDiff;
  threads: InlineCommentThread[];
  repoId: string;
  prNumber: number;
  headOid: string;
  collapsedOverride: boolean | undefined;
  onCollapsedChange: (collapsed: boolean) => void;
  activeMatch?: DiffMatch;
  highlight?: DiffHighlight | null;
  findings?: AIReviewFinding[];
  readOnly?: boolean;
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
  // Findings not yet turned into drafts; anchored ones render on their line.
  const pendingFindings = useMemo(() => {
    const added = new Set(
      [...draft.comments, ...draft.fileComments].filter((c) => c.uid.startsWith('ai-')).map((c) => c.uid.slice(3))
    );
    return (findings ?? []).filter((f) => !added.has(f.id));
  }, [findings, draft.comments, draft.fileComments]);
  const fileLevelFindings = pendingFindings.filter((f) => !f.anchored || f.line == null);
  const lineFindings = pendingFindings.filter((f) => f.anchored && f.line != null);

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
      className={`diff-file rounded-md border border-border bg-canvas-subtle/40 transition-opacity ${
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
          {pendingFindings.length > 0 && (
            <span
              className="text-2xs text-accent tabular-nums"
              title={`${pendingFindings.length} AI finding${pendingFindings.length === 1 ? '' : 's'}`}
            >
              ✦ {pendingFindings.length}
            </span>
          )}
          {!readOnly && (<>
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
          </>)}
        </div>
      </header>
      {!collapsed && (
        <div className="overflow-hidden rounded-b-md">
          {(fileDrafts.length > 0 || fileComposerOpen || fileLevelFindings.length > 0) && (
            <div className="px-3 pt-3 space-y-2 border-b border-border-muted pb-3 bg-canvas">
              {fileLevelFindings.map((f) => (
                <FindingInline key={f.id} finding={f} repoId={repoId} prNumber={prNumber} />
              ))}
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
              activeMatch={activeMatch}
              highlight={highlight}
              findings={lineFindings}
              repoId={repoId}
              prNumber={prNumber}
              readOnly={readOnly}
            />
          )}
        </div>
      )}
    </section>
  );
});

/** Reconstruct a single-file unified patch from our parsed hunks. */
function fileDiffToPatch(file: FileDiff): string {
  const oldName = file.oldPath ?? file.path;
  const oldHeader = file.status === 'added' ? '/dev/null' : `a/${oldName}`;
  const newHeader = file.status === 'removed' ? '/dev/null' : `b/${file.path}`;
  const out: string[] = [
    `diff --git a/${oldName} b/${file.path}`,
    `--- ${oldHeader}`,
    `+++ ${newHeader}`
  ];
  for (const h of file.hunks) {
    out.push(h.header);
    for (const l of h.lines) {
      out.push((l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.content);
    }
  }
  return out.join('\n') + '\n';
}

type AnnoMeta =
  | { kind: 'thread'; thread: InlineCommentThread }
  | { kind: 'draft'; draft: DraftInlineComment }
  | { kind: 'finding'; finding: AIReviewFinding }
  | { kind: 'composer' };

interface ComposerState {
  side: AnnotationSide;
  /** Set when the comment spans startLine..line. */
  startLine?: number;
  line: number;
}

function DiffBody({
  file,
  threads,
  activeMatch,
  highlight,
  findings,
  repoId,
  prNumber,
  readOnly
}: {
  file: FileDiff;
  threads: InlineCommentThread[];
  activeMatch?: DiffMatch;
  highlight?: DiffHighlight | null;
  findings: AIReviewFinding[];
  repoId: string;
  prNumber: number;
  readOnly?: boolean;
}) {
  const draft = useUI((s) => s.getDraft());
  const addDraftComment = useUI((s) => s.addDraftComment);
  const removeDraftComment = useUI((s) => s.removeDraftComment);

  const themePref = useUI((s) => s.theme);
  const diffFontSize = useUI((s) => s.diffFontSize);
  const diffDensity = useUI((s) => s.diffDensity);
  const lineHeight = diffDensity === 'comfortable' ? 1.9 : 1.45;

  const patch = useMemo(() => fileDiffToPatch(file), [file]);

  const [composer, setComposer] = useState<ComposerState | null>(null);
  // Range the user is currently dragging over. With `controlledSelection`
  // the library paints nothing on its own, so we echo the in-progress range
  // back through `selectedLines` to give live feedback before pointer-up.
  const [dragRange, setDragRange] = useState<SelectedLineRange | null>(null);

  const lineAnnotations = useMemo<DiffLineAnnotation<AnnoMeta>[]>(() => {
    const list: DiffLineAnnotation<AnnoMeta>[] = [];
    for (const t of threads) {
      if (t.line == null) continue;
      list.push({
        side: t.side === 'LEFT' ? 'deletions' : 'additions',
        lineNumber: t.line,
        metadata: { kind: 'thread', thread: t }
      });
    }
    if (!readOnly) {
      for (const c of draft.comments) {
        if (c.path !== file.path) continue;
        list.push({
          side: c.side === 'LEFT' ? 'deletions' : 'additions',
          lineNumber: c.line,
          metadata: { kind: 'draft', draft: c }
        });
      }
      for (const f of findings) {
        if (f.line == null) continue;
        list.push({
          side: f.side === 'LEFT' ? 'deletions' : 'additions',
          lineNumber: f.line,
          metadata: { kind: 'finding', finding: f }
        });
      }
    }
    if (composer) {
      list.push({
        side: composer.side,
        lineNumber: composer.line,
        metadata: { kind: 'composer' }
      });
    }
    return list;
  }, [threads, draft.comments, file.path, composer, findings, readOnly]);

  // An in-progress drag wins; then, while composing, the selection shows
  // the commented range; then a jump-to-finding spotlight; otherwise the
  // active search match line (if it's in this file) gets the highlight.
  const selectedLines = useMemo<SelectedLineRange | null>(() => {
    if (dragRange) return dragRange;
    if (composer) {
      return {
        start: composer.startLine ?? composer.line,
        end: composer.line,
        side: composer.side,
        endSide: composer.side
      };
    }
    if (highlight && highlight.line != null) {
      const side: AnnotationSide = highlight.side === 'LEFT' ? 'deletions' : 'additions';
      return {
        start: highlight.startLine ?? highlight.line,
        end: highlight.line,
        side,
        endSide: side
      };
    }
    if (activeMatch?.kind === 'line' && activeMatch.filePath === file.path) {
      const line = file.hunks[activeMatch.hunkIndex]?.lines[activeMatch.lineIndex];
      if (line) {
        const side: AnnotationSide = line.type === 'del' ? 'deletions' : 'additions';
        const num = side === 'deletions' ? line.oldNo : line.newNo;
        if (num != null) return { start: num, end: num, side, endSide: side };
      }
    }
    return null;
  }, [dragRange, highlight, composer, activeMatch, file]);

  const options = useMemo(
    () => ({
      diffStyle: 'unified' as const,
      disableFileHeader: true,
      themeType: (themePref === 'light' ? 'light' : 'dark') as 'light' | 'dark',
      theme: { dark: 'github-dark', light: 'github-light' },
      enableLineSelection: !readOnly,
      controlledSelection: true,
      lineHoverHighlight: 'number' as const,
      onLineNumberClick: (p: { lineNumber: number; annotationSide: AnnotationSide }) => {
        if (!readOnly) setComposer({ side: p.annotationSide, line: p.lineNumber });
      },
      onLineSelectionStart: (range: SelectedLineRange | null) => setDragRange(range),
      onLineSelectionChange: (range: SelectedLineRange | null) => setDragRange(range),
      onLineSelectionEnd: (range: SelectedLineRange | null) => {
        setDragRange(null);
        if (!range) return;
        const side = range.endSide ?? range.side ?? 'additions';
        setComposer({
          side,
          startLine: range.start !== range.end ? range.start : undefined,
          line: range.end
        });
      }
    }),
    [themePref, readOnly]
  );

  function saveComposer(body: string) {
    if (!composer || !body.trim()) return;
    const ghSide = composer.side === 'deletions' ? 'LEFT' : 'RIGHT';
    addDraftComment({
      uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      path: file.path,
      line: composer.line,
      side: ghSide,
      startLine: composer.startLine,
      startSide: composer.startLine != null ? ghSide : undefined,
      body: body.trim()
    });
    setComposer(null);
  }

  function renderAnnotation(a: DiffLineAnnotation<AnnoMeta>) {
    const m = a.metadata;
    if (m.kind === 'thread') {
      return (
        <CommentBubble
          author={m.thread.user.login}
          body={m.thread.body}
          date={m.thread.createdAt}
        />
      );
    }
    if (m.kind === 'finding') {
      return <FindingInline finding={m.finding} repoId={repoId} prNumber={prNumber} />;
    }
    if (m.kind === 'draft') {
      return (
        <CommentBubble
          author={m.draft.uid.startsWith('ai-') ? 'you (draft, from AI)' : 'you (draft)'}
          body={m.draft.body}
          rangeLabel={draftRangeLabel(m.draft)}
          onRemove={() => removeDraftComment(m.draft.uid)}
        />
      );
    }
    return (
      <Composer
        rangeLabel={
          composer && composer.startLine != null
            ? `lines ${composer.startLine}–${composer.line}`
            : `line ${composer?.line ?? ''}`
        }
        onCancel={() => setComposer(null)}
        onSave={saveComposer}
      />
    );
  }

  return (
    <div
      className="font-mono"
      style={
        {
          fontSize: `${diffFontSize}px`,
          lineHeight,
          '--diffs-font-size': `${diffFontSize}px`,
          '--diffs-line-height': `${Math.round(diffFontSize * lineHeight)}px`
        } as React.CSSProperties
      }
    >
      <PatchDiff<AnnoMeta>
        patch={patch}
        options={options}
        lineAnnotations={lineAnnotations}
        selectedLines={selectedLines}
        renderAnnotation={renderAnnotation}
      />
    </div>
  );
}

function draftRangeLabel(d: DraftInlineComment): string | undefined {
  if (d.startLine != null && d.startLine !== d.line) {
    return `lines ${d.startLine}–${d.line}`;
  }
  return undefined;
}

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
    <div className="my-1 rounded-md border border-border-muted bg-canvas-overlay px-3 py-2 max-w-2xl font-sans">
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

/**
 * Inline comment composer rendered as a line annotation. Owns its textarea
 * state so typing doesn't force the diff (and its annotation list) to
 * re-render on every keystroke.
 */
function Composer({
  rangeLabel,
  onCancel,
  onSave
}: {
  rangeLabel: string;
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="my-1 rounded-md border border-accent/40 bg-canvas-overlay px-3 py-2 max-w-2xl animate-slide-up font-sans">
      <div className="text-2xs text-accent mb-1">Comment on {rangeLabel}</div>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Leave a comment…"
        className="w-full bg-canvas-inset border border-border-muted rounded-md p-2 text-xs text-fg outline-none focus:border-accent resize-y"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (body.trim()) onSave(body);
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
            disabled={!body.trim()}
            onClick={() => onSave(body)}
          >
            Add to review
          </button>
        </div>
      </div>
    </div>
  );
}

function DiffViewerSkeleton() {
  return (
    <div className="flex-1 overflow-hidden p-3 space-y-3 animate-fade-in">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border-muted overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border-muted flex items-center gap-2 bg-canvas-inset/60">
            <Skeleton className="h-3.5 w-3.5 rounded-sm" />
            <Skeleton className="h-3.5 w-56" />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-3.5 w-10" />
            </div>
          </div>
          <div className="p-3 space-y-1.5 font-mono">
            {[
              '95%',
              '70%',
              '85%',
              '40%',
              '78%',
              '60%',
              '88%'
            ].map((w, j) => (
              <Skeleton key={j} className="h-3" style={{ width: w }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
