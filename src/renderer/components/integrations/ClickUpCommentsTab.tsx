import { useQuery } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { Skeleton } from '../ui/skeleton';

export function ClickUpCommentsTab({ taskId }: { taskId: string }) {
  const q = useQuery({
    queryKey: qk.clickupComments(taskId),
    queryFn: () => unwrap(api.integrations.clickup.taskComments(taskId))
  });

  if (q.isLoading) {
    return (
      <div className="p-5 space-y-3 animate-fade-in">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16 ml-auto" />
            </div>
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[78%]" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
        ))}
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="p-5 text-sm text-danger">{(q.error as ApiError).message}</div>
    );
  }
  const comments = q.data ?? [];
  if (comments.length === 0) {
    return <div className="p-5 text-sm text-fg-subtle">No comments on this task.</div>;
  }

  return (
    <div className="overflow-y-auto p-5 space-y-3">
      {comments.map((c) => (
        <div
          key={c.id}
          className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4"
        >
          <div className="flex items-center gap-2 text-2xs text-fg-subtle mb-1">
            <span className="text-fg">@{c.user.username}</span>
            <span>· {relativeTime(new Date(Number(c.date)).toISOString())}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-fg leading-relaxed">{c.text}</div>
        </div>
      ))}
    </div>
  );
}
