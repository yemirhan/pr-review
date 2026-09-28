import { MessageSquare, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUI } from '../../store/ui';
import { Markdown } from './Markdown';
import { SEVERITY_BORDER, SEVERITY_LABEL, SEVERITY_TEXT } from './severity';
import { useFindingActions } from './useFindingActions';
import type { AIReviewFinding } from '@shared/types';

/**
 * An AI finding rendered in the diff, under the line it's about. Adding it
 * turns it into a draft comment (rendered by the diff as a draft bubble).
 */
export function FindingInline({
  finding: f,
  repoId,
  prNumber,
  className
}: {
  finding: AIReviewFinding;
  repoId: string;
  prNumber: number;
  className?: string;
}) {
  const { add, setDismissed } = useFindingActions(repoId, prNumber);
  const ask = useUI((s) => s.askAboutFinding);

  return (
    <div
      data-finding-id={f.id}
      className={cn(
        'my-1.5 w-full max-w-3xl whitespace-normal break-words rounded-md border border-border-muted border-l-2 bg-canvas-overlay px-3 py-2.5 font-sans shadow-sm',
        SEVERITY_BORDER[f.severity],
        className
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xs font-medium shrink-0', SEVERITY_TEXT[f.severity])}>
              {SEVERITY_LABEL[f.severity]}
            </span>
            <span className="text-sm font-medium text-fg leading-snug">{f.title}</span>
          </div>
        </div>
        <span className="text-2xs text-fg-subtle shrink-0">AI</span>
      </div>
      <Markdown text={f.body} className="mt-1.5 text-fg-muted [&_p]:text-fg" />
      {f.suggestion && (
        <div className="mt-2 rounded-md border border-border-muted overflow-hidden">
          <div className="px-2.5 py-1 text-2xs text-fg-subtle bg-canvas-subtle border-b border-border-muted">
            Suggested change
          </div>
          <pre className="px-2.5 py-2 text-xs font-mono bg-diff-addBg overflow-x-auto whitespace-pre text-fg">
            {f.suggestion}
          </pre>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <button className="btn h-7 text-xs" onClick={() => add(f)}>
          <Plus className="h-3.5 w-3.5" />
          Add to review
        </button>
        <button className="btn-ghost h-7 text-xs" onClick={() => ask(f.id)}>
          <MessageSquare className="h-3.5 w-3.5" />
          Ask
        </button>
        <button className="btn-ghost h-7 text-xs ml-auto" onClick={() => void setDismissed(f, true)}>
          <X className="h-3.5 w-3.5" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
