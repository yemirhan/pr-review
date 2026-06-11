# Merge status indicator + PR refresh — design

Date: 2026-06-11
Status: approved

## Problem

The Merge button (`src/renderer/components/PRDetail.tsx`) is disabled whenever
`pr.mergeable !== true`, with only a hover `title` tooltip explaining why.
GitHub computes mergeability lazily: after any push to the PR or its base
branch, `mergeable` is `UNKNOWN` (mapped to `null`) until GitHub recomputes.
Because PR data only refetches on window focus or 30s staleness, the button
can sit disabled for minutes with nothing visibly wrong, and there is no
manual way to reload a PR.

## Goals

1. Always-visible explanation of why merging is unavailable (or risky).
2. Manual refresh for the open PR (and its related queries).
3. The button should enable itself once GitHub finishes computing
   mergeability, without user action.

## Design

### 1. Merge status indicator

New `src/renderer/components/MergeStatus.tsx`:

- `getMergeStatus(pr)` — pure function mapping
  `(state, isDraft, mergeable, mergeStateStatus)` to
  `{ canMerge, label, tone, checking, conflicts }`. Evaluation order:

  | Condition | canMerge | Label | Tone |
  |---|---|---|---|
  | `state !== 'OPEN'` | false | none (button replaced by Merged/Closed chip) | — |
  | `isDraft` | false | "Draft — mark ready for review to merge" | subtle |
  | `mergeable === false` | false | "Merge conflicts with base branch" (links to Conflicts tab) | danger |
  | `mergeable === null` | false | "Checking mergeability…" + xs spinner | subtle |
  | `mergeStateStatus === 'BLOCKED'` | true | "Blocked: required reviews or checks" | attention |
  | `'BEHIND'` | true | "Branch is behind base" | attention |
  | `'UNSTABLE'` | true | "Some checks failing" | attention |
  | otherwise (CLEAN, HAS_HOOKS, …) | true | none | — |

- `MergeStatusPopover` — wraps the Merge button and shows the explanation in
  a hover popover (CSS `group-hover`, styled like `DropdownMenuContent`; no
  new dependency). The hover lives on the wrapper because disabled buttons
  have pointer-events disabled. The popover shows a tone-colored headline
  (with spinner/info/warning icon), a longer detail sentence, and — for
  conflicts — a "View conflicting files" link that switches to the Conflicts
  tab. Tones use existing tokens (`text-fg-subtle`, `text-attention`,
  `text-danger`).

Behavior changes bundled in:
- Draft PRs disable the Merge button (merging a draft fails anyway).
- Merged/closed PRs show a state chip instead of a permanently disabled button.
- `BLOCKED` keeps the button enabled (matches current behavior when
  `mergeable === true`; admins can still merge).

### 2. Refresh button

Ghost icon button (`RotateCw`) in the PR header action row. Calls the existing
`invalidatePR()` (which already invalidates the PR detail, list, comments, and
ClickUp queries). Icon spins and the button disables while `detailQ.isFetching`.

### 3. Smart auto-poll

`refetchInterval` on the PR detail query: 5s while the PR is open and
`mergeable === null`; `false` otherwise. No polling in steady state, so no
extra `gh` calls once mergeability is resolved.

## Out of scope

- No main-process changes (`mergeable`/`mergeStateStatus` already fetched).
- No tooltip library; native `title` attributes stay.
- No test runner setup (project has none); `getMergeStatus` is a pure
  function so it can be unit-tested if one is added later.

## Verification

`npm run typecheck`, plus manual run: open a PR right after pushing to it and
watch "Checking mergeability…" resolve into an enabled button; open a
conflicting PR and use the indicator link to reach the Conflicts tab.
