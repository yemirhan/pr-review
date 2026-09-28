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

export interface MergeOptions {
  /** `gh pr merge --admin`: bypass branch protection with admin privileges. */
  admin?: boolean;
  /** `gh pr merge --auto`: enable auto-merge once requirements are met. */
  auto?: boolean;
  /** Delete the head branch after merging. */
  deleteBranch?: boolean;
}

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
    | 'RATE_LIMITED'
    | 'UNKNOWN'
    | 'AI_NOT_AUTHENTICATED'
    | 'AI_CANCELLED'
    | 'AI_FAILED'
    | 'AI_WORKING_TREE_DIRTY'
    | 'AI_WRONG_BRANCH'
    | 'WORKSPACE_DIRTY'
    | 'WORKSPACE_FAILED'
    | 'GIT_PUSH_FAILED'
    | 'CLICKUP_NOT_CONFIGURED'
    | 'CLICKUP_UNAUTHORIZED'
    | 'CLICKUP_NOT_FOUND'
    | 'CLICKUP_FAILED'
    | 'JENKINS_NOT_CONFIGURED'
    | 'JENKINS_UNAUTHORIZED'
    | 'JENKINS_NOT_FOUND'
    | 'JENKINS_FAILED'
    | 'VERCEL_NOT_CONFIGURED'
    | 'VERCEL_UNAUTHORIZED'
    | 'VERCEL_NOT_FOUND'
    | 'VERCEL_FAILED';
  message: string;
  stderr?: string;
  /** Set for RATE_LIMITED: how long the client should wait before retrying. */
  retryAfterMs?: number;
}

/** A top-level (non-inline) comment on the PR's conversation timeline. */
export interface PRIssueComment {
  id: number;
  user: PRAuthor;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
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

/** Result of checking the saved Jenkins credentials. Never throws. */
export type JenkinsStatus =
  | { state: 'unconfigured' }
  | { state: 'ok'; user: string; baseUrl: string; username: string }
  | { state: 'error'; code: string; message: string; baseUrl: string | null; username: string | null };

/** A multibranch pipeline discovered on the Jenkins server. */
export interface JenkinsJob {
  /** Path under the base URL, as Jenkins encodes it, e.g. `job/Folder/job/My%20App`. */
  jobPath: string;
  displayName: string;
  /** Parent folder names, if the job lives in a folder. */
  folder: string | null;
  url: string;
}

/** Builds of one pipeline's job for a PR's branch (or its `PR-<n>` job). */
export interface JenkinsPipelineBuilds {
  jobPath: string;
  label: string;
  /** URL of the branch/PR job inside the multibranch pipeline. */
  branchJobUrl: string;
  branchJobName: string;
  kind: 'branch' | 'pr';
  inQueue: boolean;
  builds: JenkinsBuild[];
}

export interface JenkinsPRBuilds {
  pipelines: JenkinsPipelineBuilds[];
  /** Linked pipelines for the repo. */
  linked: number;
  /** Linked job paths that no longer exist on the server. */
  missing: string[];
  /** Pipelines that failed to load (network, permissions). */
  errors: { jobPath: string; message: string }[];
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

// ---------------------------------------------------------------------------
// Vercel integration
// ---------------------------------------------------------------------------

export interface VercelConfig {
  token: string | null;
  /** Team id (team_…). Personal accounts leave blank. */
  teamId: string | null;
  /** Project ids not shown on PRs. Projects are matched to repos by their Git link. */
  hiddenProjects: string[];
}

export interface VercelTeam {
  id: string;
  slug: string;
  name: string;
}

export interface VercelAuthResult {
  ok: boolean;
  user?: string;
}

export type VercelDeploymentState =
  | 'READY'
  | 'BUILDING'
  | 'INITIALIZING'
  | 'QUEUED'
  | 'ERROR'
  | 'CANCELED'
  | 'UNKNOWN';

export interface VercelDeployment {
  uid: string;
  /** Hostname like `myapp-abc123.vercel.app` (no scheme). */
  url: string;
  /** Direct dashboard URL for inspecting the deployment. */
  inspectorUrl: string | null;
  state: VercelDeploymentState;
  target: 'preview' | 'production' | null;
  createdAt: number;
  readyAt: number | null;
  buildingAt: number | null;
  branch: string | null;
  commitSha: string | null;
  commitMessage: string | null;
  creator: string | null;
}

export interface VercelProjectLookup {
  id: string;
  name: string;
  framework: string | null;
  /** `owner/name` of the linked Git repository, if any. */
  repo: string | null;
  rootDirectory: string | null;
}

/** One Vercel project's deployments of a PR's branch. */
export interface VercelProjectDeployments {
  projectId: string;
  projectName: string;
  /** Newest deployment of the PR head commit, else newest of the branch. */
  latest: VercelDeployment;
  /** Whether `latest` is for the PR's head commit. */
  atHead: boolean;
  history: VercelDeployment[];
}

export interface VercelPRDeployments {
  projects: VercelProjectDeployments[];
  hidden: number;
}

/** Which backend powers the AI review / chat panel. */
export type AIProvider = 'claude' | 'codex';

/** Source of credentials the AI client can use. */
export type AIAuthSource =
  | 'claude-code'
  | 'api-key'
  | 'codex-chatgpt'
  | 'codex-api-key'
  | 'none';

export interface AIAuthStatus {
  provider: AIProvider;
  available: boolean;
  source: AIAuthSource;
  /** Human-readable detail (e.g. model in use, or why auth is unavailable). */
  detail?: string;
}

export type AILanguage = 'en' | 'tr';

export type AIReviewDepth = 'quick' | 'thorough';

export interface AIConfig {
  /** Default provider for new reviews; each review can override it. */
  provider: AIProvider;
  /** Codex model id; null = whatever ~/.codex/config.toml selects. */
  codexModel: string | null;
  /** Codex reasoning effort override; null = picked from the review depth. */
  codexReasoningEffort: string | null;
  /** Claude model used for thorough reviews and chat. */
  claudeModel: string;
  /** Default review depth. */
  depth: AIReviewDepth;
  /** Start a review automatically when a PR without a current review is opened. */
  autoReview: boolean;
  /** Language the reviewer writes its verdict and comments in. */
  language: AILanguage;
  /** Custom review directive (persona + checklist); null = built-in default. */
  directive: string | null;
}

export interface AICodexModel {
  id: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  reasoningEfforts: string[];
  defaultReasoningEffort: string;
}

export interface AIClaudeModel {
  id: string;
  label: string;
  description: string;
}

export type AIFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface AIReviewFinding {
  /** Stable across re-runs: hash of path, anchored line text and title. */
  id: string;
  path: string;
  /** End line of the finding (new side unless side === 'LEFT'); null when unanchored. */
  line: number | null;
  /** Set for multi-line findings. */
  startLine?: number;
  side: 'LEFT' | 'RIGHT';
  severity: AIFindingSeverity;
  /** One-line headline. */
  title: string;
  /** Problem → impact → fix, ready to post as an inline comment. */
  body: string;
  /** Exact replacement for lines startLine..line, when the fix is small. */
  suggestion?: string | null;
  /**
   * Whether path/line resolve to a line in the diff. Unanchored findings are
   * still shown but can only be added as file-level comments.
   */
  anchored: boolean;
}

export type AISessionStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Finding the question was about, when asked from a finding. */
  findingId?: string;
}

/**
 * One AI review of a PR, owned by the main process. It survives panel
 * collapse and PR switches, and is persisted per PR (latest review only).
 */
export interface AISession {
  repoId: string;
  prNumber: number;
  /** Head commit the review looked at. */
  headOid: string;
  provider: AIProvider;
  model: string | null;
  depth: AIReviewDepth;
  status: AISessionStatus;
  startedAt: number;
  finishedAt: number | null;
  /** Recent progress lines (tool calls, file reads). */
  progress: string[];
  /** Verdict, 1-3 sentences. Empty until the model writes it. */
  verdict: string;
  findings: AIReviewFinding[];
  notes: string[];
  /** Finding ids the user dismissed. Survive re-runs because ids are stable. */
  dismissed: string[];
  /** Raw model output when it couldn't be parsed. */
  raw?: string;
  error?: GhError | null;
  costUSD?: number;
  durationMs?: number;
  /** True when the model ran in a checkout of the PR head. */
  usedWorktree: boolean;
  chat: AIChatMessage[];
  /** In-flight chat reply, streamed. */
  chatStream: { message: string; text: string; status: string | null; findingId?: string } | null;
  /** Provider conversation handle (Codex thread id) for follow-up chat. */
  threadId?: string | null;
}

/** Lightweight per-PR summary for list badges. */
export interface AISessionSummary {
  repoId: string;
  prNumber: number;
  headOid: string;
  status: AISessionStatus;
  findings: number;
}

export interface AIReviewStartOptions {
  provider?: AIProvider;
  depth?: AIReviewDepth;
}

export interface AIApplyPreflight {
  currentBranch: string;
  branchMatches: boolean;
  dirty: boolean;
}

export type AIApplyProgress =
  | { kind: 'tool'; name: string; path?: string }
  | { kind: 'text'; text: string };

export interface AIApplyProgressEvent {
  streamId: string;
  event: AIApplyProgress;
}

export interface AIApplyResult {
  diff: FileDiff[];
  commitMessage: string;
  assistantText: string;
  /** Snapshot of untracked files captured before apply; used to scope discards. */
  untrackedBefore: string[];
}

export type SystemToolId = 'gh' | 'claude' | 'codex';

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

/** A user-facing git worktree checked out for one PR (see main/git/workspaces.ts). */
export interface PRWorkspace {
  repoId: string;
  prNumber: number;
  path: string;
  /** Local branch checked out in the worktree. */
  branch: string;
  /** True when we created the branch (so cleanup may delete it). */
  createdBranch: boolean;
  createdAt: number;
}

/** Workspace plus live git state, for the cleanup list. */
export interface PRWorkspaceStatus extends PRWorkspace {
  exists: boolean;
  /** Uncommitted changes (tracked + untracked). */
  dirty: number;
  /** Commits not on the upstream branch; null when there is no upstream. */
  unpushed: number | null;
  /** PR state from GitHub when known. */
  prState: 'OPEN' | 'MERGED' | 'CLOSED' | null;
  prTitle: string | null;
}

export interface ReviewCacheInfo {
  count: number;
  inUse: number;
}
