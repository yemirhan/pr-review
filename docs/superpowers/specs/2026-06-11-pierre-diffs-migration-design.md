# Migrate diff rendering to @pierre/diffs — design

Date: 2026-06-11
Status: approved (scope: full replacement, chosen by user)

## Problem / goal

Replace the custom diff renderer (`DiffViewer.tsx`, ~950 lines: hand-rolled
rows, shiki worker, manual gutter selection) with the open-source
`@pierre/diffs` library (Apache-2.0, React 19 compatible, Shiki-based,
Shadow DOM + CSS grid rendering).

## Architecture decision

**Per-file `PatchDiff` components inside our existing chrome**, not the
library's all-in-one `CodeView`. Reasons:

- Our `FilePanel` header (collapse toggle, status chip, +/- stats, diff bar,
  file-level comment composer, "Viewed" checkbox) survives unchanged with
  `options.disableFileHeader: true`.
- Our wrapper `<section data-file-path>` / `<header data-file-header>`
  elements stay in the light DOM, so file-tree jump-to-file, visible-file
  tracking, and search file-anchoring keep working without rework.
- `CodeView` would buy virtualization and line-precise scrollTo at the cost
  of rebuilding all of that chrome inside library slots.

## Data flow

- No main-process changes. A renderer helper `fileDiffToPatch(file)`
  reconstructs a unified per-file patch from `FileDiff.hunks` (synthesizing
  `diff --git` / `---` / `+++` headers, `/dev/null` for added/removed files).
  Works for both pipelines (GitHub PR files API and `git diff` output), so
  `FileDiff.patch` presence doesn't matter. Known loss: "\ No newline at end
  of file" markers are not reproduced.
- Binary files keep the "Binary file not shown." placeholder (no patch).

## Rendering

- `PatchDiff` from `@pierre/diffs/react` per file with options:
  `diffStyle: 'unified'`, `disableFileHeader: true`,
  `theme: { dark: 'github-dark', light: 'github-light' }`,
  `themeType` from the UI store theme.
- Worker pool: `WorkerPoolContextProvider` at the renderer root with
  `workerFactory: () => new Worker(new URL('@pierre/diffs/worker/worker.js',
  import.meta.url), { type: 'module' })` (Vite bundles module workers).
- Font size/density from the UI store apply via inherited CSS
  (`font-size`/`line-height` pierce the Shadow DOM boundary).
- The bespoke shiki worker pipeline (`lib/highlight.ts`,
  `workers/shiki.worker.ts`) stays — ConflictsView still uses it.

## Comments

- Existing threads + local drafts render as `lineAnnotations`
  (`DiffLineAnnotation<Meta>`): side `'additions'`/`'deletions'` from the
  GitHub `RIGHT`/`LEFT` side, `lineNumber` as-is. `renderAnnotation` renders
  the ported `CommentBubble` / `Composer` components (light-DOM React, same
  styling as today).
- New comments: the library's built-in interactions replace the hand-rolled
  gutter pointer tracking — `enableLineSelection: true`,
  `onLineSelectionEnd(range)` opens the composer for a range,
  `onLineNumberClick` opens it for a single line. `selectedLines` is
  controlled while the composer is open. Range side mapping:
  `additions → RIGHT`, `deletions → LEFT` (same rules as before).
- File-level comments: unchanged (they live in our chrome, not the diff).

## Search (degraded, kept useful)

- Match indexing (`useDiffSearch`) is unchanged — it works on our parsed
  `FileDiff[]`, not the DOM.
- Files with matches still auto-expand; match count + next/prev navigation
  still work.
- The active line match is shown by setting that file's `selectedLines` to
  the matched line (library line highlight) and scrolling to the file
  section (existing `useScrollToMatch` already falls back to the file header
  when it can't find a row — rows are now in Shadow DOM, so the fallback
  path is the path).
- Lost: yellow `<mark>` substring highlighting inside lines (Shadow DOM owns
  line content now). `lineMatchMap` prop is removed.

## Out of scope

- ConflictsView (still the custom renderer; `UnresolvedFile` adoption can be
  a follow-up).
- Split view, hunk expansion — library supports them; not wired up yet.
- Removing `parse-diff`/custom parsing from main (still feeds FileTree,
  search, comment line math).

## Verification

`npm run typecheck` && `npm run build`; manual `npm run dev` pass over a PR
with comments, search, viewed-collapse, and the AI panel diff preview.
