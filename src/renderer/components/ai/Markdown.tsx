import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

export function Pulse({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
      {text}
    </div>
  );
}

export function Markdown({
  text,
  streaming,
  emptyPlaceholder,
  className
}: {
  text: string;
  streaming?: boolean;
  emptyPlaceholder?: string;
  className?: string;
}) {
  if (!text && emptyPlaceholder) return <Pulse text={emptyPlaceholder} />;
  return (
    <div className={cn('ai-md text-sm text-fg leading-relaxed break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-fg" {...p} />,
          h2: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-fg" {...p} />,
          h3: (p) => <h4 className="text-sm font-semibold mt-2 mb-1 text-fg" {...p} />,
          p: (p) => <p className="mb-2 last:mb-0" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...p} />,
          code: ({ className: cls, children, ...rest }) =>
            /language-/.test(cls ?? '') ? (
              <code
                className="block bg-canvas-inset border border-border-muted rounded-md px-2.5 py-2 text-xs font-mono overflow-x-auto whitespace-pre"
                {...rest}
              >
                {children}
              </code>
            ) : (
              <code className="font-mono text-[0.92em] bg-canvas-subtle px-1 py-px rounded" {...rest}>
                {children}
              </code>
            ),
          pre: (p) => <pre className="mb-2 last:mb-0" {...p} />,
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) api.shell.openExternal(href);
              }}
              className="text-accent hover:underline"
              {...rest}
            >
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-1.5 h-3.5 -mb-0.5 bg-fg-muted animate-pulse align-middle" />
      )}
    </div>
  );
}
