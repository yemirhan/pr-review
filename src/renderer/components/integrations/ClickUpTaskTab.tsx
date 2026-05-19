import { api } from '../../lib/api';
import type { ClickUpTask } from '@shared/types';

export function ClickUpTaskTab({ task }: { task: ClickUpTask }) {
  return (
    <div className="overflow-y-auto p-5 space-y-4">
      <div className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="text-2xs text-fg-subtle mb-0.5 font-mono">
              {task.customId || task.id}
            </div>
            <h2 className="text-base font-semibold text-fg leading-snug">{task.name}</h2>
          </div>
          <button
            className="btn shrink-0"
            onClick={() => api.shell.openExternal(task.url)}
            title="Open in ClickUp"
          >
            Open in ClickUp
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2 text-2xs">
          <StatusChip color={task.status.color} label={task.status.status} />
          <span className="text-fg-subtle">
            List: <span className="text-fg">{task.list.name}</span>
          </span>
          {task.priority && (
            <span className="text-fg-subtle">
              Priority:{' '}
              <span style={{ color: task.priority.color }}>{task.priority.priority}</span>
            </span>
          )}
          {task.dueDate && (
            <span className="text-fg-subtle">
              Due: <span className="text-fg">{new Date(Number(task.dueDate)).toLocaleDateString()}</span>
            </span>
          )}
        </div>
        {task.assignees.length > 0 && (
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-2xs text-fg-subtle">Assignees:</span>
            {task.assignees.map((a) => (
              <span
                key={String(a.id)}
                className="text-2xs px-2 py-0.5 rounded-full border border-border-muted text-fg"
                style={{ borderColor: a.color ?? undefined }}
              >
                {a.username}
              </span>
            ))}
          </div>
        )}
        {task.tags && task.tags.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {task.tags.map((t) => (
              <span
                key={t.name}
                className="text-2xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: t.tag_bg ?? 'transparent',
                  color: t.tag_fg ?? undefined,
                  border: '1px solid var(--c-border-muted)'
                }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {(task.textContent || task.description) && (
        <div className="rounded-md border border-border-muted bg-canvas-subtle/40 p-4">
          <div className="text-2xs text-fg-subtle mb-2">Description</div>
          <div className="whitespace-pre-wrap text-sm text-fg leading-relaxed">
            {task.textContent || task.description}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusChip({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 h-5 rounded text-2xs font-medium"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}66` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
