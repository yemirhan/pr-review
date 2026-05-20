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

export type PRCheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface PRCheckRun {
  /** Human-readable check name (job name for Actions). */
  name: string;
  /** Containing workflow file/name, if from GitHub Actions. */
  workflow: string | null;
  /** Raw state from gh (e.g. SUCCESS, FAILURE, IN_PROGRESS, QUEUED, NEUTRAL). */
  state: string | null;
  /** Normalized bucket: pass | fail | pending | skipping | cancel. */
  bucket: PRCheckBucket;
  /** Link back to the run on github.com. */
  link: string | null;
  startedAt: string | null;
  completedAt: string | null;
  description: string | null;
  event: string | null;
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

export interface CreatePRInput {
  base: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
}

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
    | 'CLICKUP_FAILED'
    | 'JENKINS_NOT_CONFIGURED'
    | 'JENKINS_UNAUTHORIZED'
    | 'JENKINS_NOT_FOUND'
    | 'JENKINS_FAILED';
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

// ---------------------------------------------------------------------------
// Jenkins integration
// ---------------------------------------------------------------------------

export interface JenkinsPipelineConfig {
  /** Stable id used as a React key; generated client-side. */
  id: string;
  /** Display name, e.g. "API tests" or "Frontend build". */
  label: string;
  /** Path segment under baseUrl identifying the multibranch job, e.g. "job/myorg-api". */
  jobPath: string;
}

export interface JenkinsRepoConfig {
  pipelines: JenkinsPipelineConfig[];
}

export interface JenkinsConfig {
  baseUrl: string | null;
  username: string | null;
  apiToken: string | null;
  repos: Record<string, JenkinsRepoConfig>;
}

export interface JenkinsAuthResult {
  ok: boolean;
  user?: string;
}

export type JenkinsBuildResult =
  | 'SUCCESS'
  | 'FAILURE'
  | 'UNSTABLE'
  | 'ABORTED'
  | 'NOT_BUILT'
  | 'RUNNING'
  | 'UNKNOWN';

export interface JenkinsBuild {
  number: number;
  url: string;
  result: JenkinsBuildResult;
  building: boolean;
  /** Unix ms timestamp build started. */
  timestamp: number;
  /** Duration ms — 0 while building. */
  duration: number;
  estimatedDuration?: number;
  /** Best-effort cause string ("Started by user X", "Push by foo", etc.). */
  cause?: string | null;
  /** Build SHA if available from actions. */
  commitSha?: string | null;
}

export interface JenkinsStage {
  id: string;
  name: string;
  status: JenkinsBuildResult;
  durationMs: number;
}

export interface JenkinsBuildDetail extends JenkinsBuild {
  stages: JenkinsStage[];
}

export interface JenkinsTestFailure {
  className: string;
  name: string;
}

export interface JenkinsTestSummary {
  total: number;
  failed: number;
  skipped: number;
  passed: number;
  failures: JenkinsTestFailure[];
}

/** Source of credentials the AI client can use. */
export type AIAuthSource = 'claude-code' | 'api-key' | 'none';

export interface AIAuthStatus {
  available: boolean;
  source: AIAuthSource;
}

export type AIReviewMode = 'critique' | 'summary' | 'recap' | 'risk' | 'tests';

export interface AIReviewOptions {
  mode: AIReviewMode;
  includeClickUpTask?: boolean;
}

export interface AIReviewResult {
  summary: string;
  mode: AIReviewMode;
  /** Reported by SDK; may be 0 when using subscription auth. */
  costUSD?: number;
  durationMs?: number;
}

export interface AIReviewChunk {
  prNumber: number;
  /** Identifies which streaming exchange this chunk belongs to. */
  streamId: string;
  /** Incremental text appended since the last chunk. */
  text: string;
}

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIChatRequest {
  history: AIChatMessage[];
  message: string;
  includeClickUpTask?: boolean;
  /** Echoed back on stream chunks so the renderer can route them. */
  streamId: string;
}

export interface AIChatResult {
  reply: string;
  costUSD?: number;
  durationMs?: number;
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

export type SystemToolId = 'gh' | 'claude';

export interface SystemTool {
  id: SystemToolId;
  label: string;
  description: string;
  installed: boolean;
  path?: string;
  version?: string;
  installUrl: string;
  installCommand: string;
}
