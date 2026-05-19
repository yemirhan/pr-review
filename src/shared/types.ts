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

export type PRState = 'OPEN' | 'CLOSED' | 'MERGED';

/** Filter passed to listPRs. */
export type PRListState = 'open' | 'merged' | 'closed' | 'all';

export interface PRSummary {
  number: number;
  title: string;
  url: string;
  author: PRAuthor;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  /** Present for merged PRs. */
  mergedAt?: string | null;
  /** Present for closed/merged PRs. */
  closedAt?: string | null;
  state: PRState;
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
    | 'UNKNOWN'
    | 'AI_NOT_AUTHENTICATED'
    | 'AI_FAILED'
    | 'AI_WORKING_TREE_DIRTY'
    | 'AI_WRONG_BRANCH'
    | 'GIT_PUSH_FAILED'
    | 'CLICKUP_NOT_CONFIGURED'
    | 'CLICKUP_UNAUTHORIZED'
    | 'CLICKUP_NOT_FOUND'
    | 'CLICKUP_FAILED';
  message: string;
  stderr?: string;
}

export interface ClickUpStatus {
  status: string;
  color: string;
  type?: string;
  orderindex?: number;
}

export interface ClickUpAssignee {
  id: number | string;
  username: string;
  initials?: string;
  color?: string;
  profilePicture?: string;
}

export interface ClickUpList {
  id: string;
  name: string;
}

export interface ClickUpTask {
  id: string;
  customId?: string | null;
  name: string;
  description?: string;
  textContent?: string;
  url: string;
  status: ClickUpStatus;
  list: ClickUpList;
  assignees: ClickUpAssignee[];
  dueDate?: string | null;
  priority?: { priority: string; color: string } | null;
  tags?: { name: string; tag_bg?: string; tag_fg?: string }[];
}

export interface ClickUpComment {
  id: string;
  user: { id: number | string; username: string; profilePicture?: string };
  text: string;
  date: string;
}

export interface ClickUpLinked {
  task: ClickUpTask;
  /** Whether a status mapping has been configured for this repo's PR review flow. */
  mapped: boolean;
}

export type ClickUpLookupReason = 'no-token' | 'no-id' | 'not-found';

export interface ClickUpLookupResult {
  linked: ClickUpLinked | null;
  /** Set when linked is null, explains why. */
  reason?: ClickUpLookupReason;
  /** The task ID we parsed from the branch, if any. */
  parsedTaskId?: string | null;
}

export type IntegrationStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface IntegrationStatusChip {
  integrationId: string;
  label: string;
  detail?: string;
  color?: string;
  tone?: IntegrationStatusTone;
  href?: string;
}

export interface ClickUpRepoConfig {
  listId?: string;
  listName?: string;
  statusMap: {
    codeReview?: string;
    readyForQA?: string;
    inProgress?: string;
  };
}

export interface ClickUpConfig {
  apiToken: string | null;
  /** ClickUp workspace (a.k.a. team) ID, used for custom-task-id lookups. */
  teamId?: string | null;
  /** Cached workspaces from /team; useful when user has multiple. */
  teams?: { id: string; name: string }[];
  repos: Record<string, ClickUpRepoConfig>;
}

export interface ClickUpAuthResult {
  ok: boolean;
  user?: { id: number | string; username: string; email?: string };
}

/** Source of credentials the AI client can use. */
export type AIAuthSource = 'claude-code' | 'api-key' | 'none';

export interface AIAuthStatus {
  available: boolean;
  source: AIAuthSource;
}

export interface AIReviewResult {
  summary: string;
  /** Reported by SDK; may be 0 when using subscription auth. */
  costUSD?: number;
  durationMs?: number;
}

export interface AIReviewChunk {
  prNumber: number;
  /** Incremental text appended since the last chunk. */
  text: string;
}

export interface AIApplyPreflight {
  currentBranch: string;
  branchMatches: boolean;
  dirty: boolean;
}

export type AIApplyProgress =
  | { kind: 'tool'; name: string; path?: string }
  | { kind: 'text'; text: string };

export interface AIApplyResult {
  diff: FileDiff[];
  commitMessage: string;
  assistantText: string;
  /** Snapshot of untracked files captured before apply; used to scope discards. */
  untrackedBefore: string[];
}
