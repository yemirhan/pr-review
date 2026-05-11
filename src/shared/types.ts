/**
 * Types shared between main, preload, and renderer.
 */

export interface Repo {
  id: string;
  /** Local filesystem path. */
  path: string;
  /** GitHub owner. */
  owner: string;
  /** GitHub repo name. */
  name: string;
  /** Short display label = name (or owner/name on collision). */
  label: string;
  addedAt: number;
}

export interface PRAuthor {
  login: string;
  avatarUrl?: string;
}

export interface PRLabel {
  name: string;
  color: string;
}

export type CheckState =
  | 'SUCCESS'
  | 'FAILURE'
  | 'PENDING'
  | 'NEUTRAL'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface ChecksRollup {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  state: CheckState;
}

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE';

export interface PRSummary {
  number: number;
  title: string;
  url: string;
  author: PRAuthor;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  labels: PRLabel[];
  isDraft: boolean;
  reviewDecision: ReviewDecision;
  checks: ChecksRollup;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface PRCommit {
  oid: string;
  messageHeadline: string;
  authoredDate: string;
  author: PRAuthor;
}

export interface PRReviewSummary {
  id: number | string;
  author: PRAuthor;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED';
  body: string;
  submittedAt?: string;
}

export interface PRDetail extends PRSummary {
  body: string;
  commits: PRCommit[];
  reviews: PRReviewSummary[];
  mergeable: boolean | null;
  mergeStateStatus: string;
  headRefOid: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  /** Old line number (null on additions). */
  oldNo: number | null;
  /** New line number (null on deletions). */
  newNo: number | null;
  content: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  language: string;
  binary: boolean;
  hunks: DiffHunk[];
  /** Raw patch from API, useful for round-tripping inline comment positions. */
  patch?: string;
}

export interface InlineCommentThread {
  id: number;
  path: string;
  line: number | null;
  startLine: number | null;
  side: 'LEFT' | 'RIGHT';
  user: PRAuthor;
  body: string;
  createdAt: string;
  inReplyToId?: number;
}

export interface DraftInlineComment {
  /** Unique within the local draft. */
  uid: string;
  path: string;
  /** End line of the comment (new-side preferred). */
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** When set, comment spans from startLine..line (multi-line). */
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
}

export interface DraftFileComment {
  uid: string;
  path: string;
  body: string;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface ReviewDraft {
  event: ReviewEvent;
  body: string;
  comments: DraftInlineComment[];
  fileComments?: DraftFileComment[];
  /** Required when fileComments has any entries — file-level comments anchor to a commit SHA. */
  headOid?: string;
}

export type MergeStrategy = 'merge' | 'squash' | 'rebase';

export interface CheckoutProgress {
  channel: 'stdout' | 'stderr' | 'done' | 'error';
  data: string;
  exitCode?: number;
}

export interface ConflictFile {
  path: string;
  /** Merged file content with conflict markers (truncated above CONFLICT_PREVIEW_LIMIT). */
  content: string;
  truncated: boolean;
}

export interface ConflictInfo {
  /** Whether the PR is actually conflicting per gh. */
  conflicting: boolean;
  /** Files with conflicts; empty when conflicting === false. */
  files: ConflictFile[];
  /** Set when computation failed (e.g. fetch denied). */
  error?: string;
}

export interface Editor {
  id: string;
  label: string;
  /** macOS app bundle path if found, e.g. /Applications/Cursor.app */
  appPath?: string;
  /** CLI binary path if found, e.g. /usr/local/bin/cursor */
  cliPath?: string;
}

/** Typed error from main → renderer. */
export interface GhError {
  code:
    | 'GH_NOT_INSTALLED'
    | 'GH_NOT_AUTHENTICATED'
    | 'NOT_A_GIT_REPO'
    | 'NOT_A_GITHUB_REMOTE'
    | 'NOT_FOUND'
    | 'TIMEOUT'
    | 'UNKNOWN';
  message: string;
  stderr?: string;
}
