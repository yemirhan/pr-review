import type {
  ClickUpAuthResult,
  ClickUpComment,
  ClickUpStatus,
  ClickUpTask,
  GhError
} from '@shared/types';

const BASE = 'https://api.clickup.com/api/v2';

export class ClickUpClientError extends Error implements GhError {
  code: GhError['code'];
  stderr?: string;
  constructor(code: GhError['code'], message: string, stderr?: string) {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
  toJSON(): GhError {
    return { code: this.code, message: this.message, stderr: this.stderr };
  }
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (res.status === 401 || res.status === 403) {
    throw new ClickUpClientError(
      'CLICKUP_UNAUTHORIZED',
      'ClickUp rejected the API token. Check it in Settings → Integrations.'
    );
  }
  if (res.status === 404) {
    throw new ClickUpClientError('CLICKUP_NOT_FOUND', `ClickUp resource not found: ${path}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ClickUpClientError(
      'CLICKUP_FAILED',
      `ClickUp request failed (${res.status}): ${path}`,
      body
    );
  }
  return (await res.json()) as T;
}

interface RawTask {
  id: string;
  custom_id?: string | null;
  name: string;
  description?: string;
  text_content?: string;
  url: string;
  status: { status: string; color: string; type?: string; orderindex?: number };
  list: { id: string; name: string };
  assignees: Array<{
    id: number | string;
    username: string;
    initials?: string;
    color?: string;
    profilePicture?: string;
  }>;
  due_date?: string | null;
  priority?: { priority: string; color: string } | null;
  tags?: Array<{ name: string; tag_bg?: string; tag_fg?: string }>;
}

function mapTask(t: RawTask): ClickUpTask {
  return {
    id: t.id,
    customId: t.custom_id ?? null,
    name: t.name,
    description: t.description,
    textContent: t.text_content,
    url: t.url,
    status: t.status,
    list: t.list,
    assignees: t.assignees ?? [],
    dueDate: t.due_date ?? null,
    priority: t.priority ?? null,
    tags: t.tags ?? []
  };
}

/**
 * Look up a task. ClickUp accepts two flavors of ID at this endpoint:
 *   - the native task ID (a short alphanumeric like `9hx`)
 *   - a "custom task ID" set by the workspace (e.g. `1234` or `REC-1234`)
 *     — these require `?custom_task_ids=true&team_id=<teamId>`.
 *
 * Branches typically encode the custom ID. We try the custom-id form first
 * when teamId is available; otherwise fall back to native.
 */
export async function getTask(
  token: string,
  taskId: string,
  teamId?: string | null
): Promise<ClickUpTask> {
  const tryCustom = async () =>
    call<RawTask>(
      token,
      `/task/${encodeURIComponent(taskId)}?custom_task_ids=true&team_id=${encodeURIComponent(teamId!)}`
    );
  const tryNative = async () => call<RawTask>(token, `/task/${encodeURIComponent(taskId)}`);

  if (teamId) {
    try {
      return mapTask(await tryCustom());
    } catch (err) {
      if (
        err instanceof ClickUpClientError &&
        (err.code === 'CLICKUP_NOT_FOUND' || err.code === 'CLICKUP_UNAUTHORIZED')
      ) {
        return mapTask(await tryNative());
      }
      throw err;
    }
  }
  return mapTask(await tryNative());
}

export async function getTeams(
  token: string
): Promise<{ id: string; name: string }[]> {
  const res = await call<{ teams: Array<{ id: string; name: string }> }>(token, '/team');
  return (res.teams ?? []).map((t) => ({ id: t.id, name: t.name }));
}

interface RawCommentsResponse {
  comments: Array<{
    id: string;
    user: { id: number | string; username: string; profilePicture?: string };
    comment_text: string;
    date: string;
  }>;
}

export async function getTaskComments(
  token: string,
  taskId: string
): Promise<ClickUpComment[]> {
  const raw = await call<RawCommentsResponse>(
    token,
    `/task/${encodeURIComponent(taskId)}/comment`
  );
  return raw.comments.map((c) => ({
    id: c.id,
    user: c.user,
    text: c.comment_text,
    date: c.date
  }));
}

interface RawListResponse {
  id: string;
  name: string;
  statuses: ClickUpStatus[];
}

export async function getList(
  token: string,
  listId: string
): Promise<{ id: string; name: string; statuses: ClickUpStatus[] }> {
  const raw = await call<RawListResponse>(token, `/list/${encodeURIComponent(listId)}`);
  return { id: raw.id, name: raw.name, statuses: raw.statuses ?? [] };
}

export async function whoami(token: string): Promise<ClickUpAuthResult> {
  const res = await call<{ user: { id: number | string; username: string; email?: string } }>(
    token,
    '/user'
  );
  return { ok: true, user: res.user };
}

