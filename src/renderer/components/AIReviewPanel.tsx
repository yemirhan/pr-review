import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError, qk, unwrap } from '../lib/api';
import { useUI } from '../store/ui';

interface Props {
  repoId: string;
  prNumber: number;
}

export function AIReviewPanel({ repoId, prNumber }: Props) {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);

  const [streamed, setStreamed] = useState('');
  const streamedRef = useRef('');

  const authQ = useQuery({
    queryKey: qk.aiAuth,
    queryFn: () => unwrap(api.ai.authStatus()),
    staleTime: 60_000
  });

  const reviewM = useMutation({
    mutationKey: qk.aiReview(repoId, prNumber),
    mutationFn: async () => {
      streamedRef.current = '';
      setStreamed('');
      return unwrap(api.ai.review(repoId, prNumber));
    }
  });

  // Reset streamed text when switching PRs.
  useEffect(() => {
    streamedRef.current = '';
    setStreamed('');
    reviewM.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, prNumber]);

  // Subscribe to streaming chunks. Filter by prNumber so chunks from a stale
  // run on a previous PR can't leak into the current view.
  useEffect(() => {
    const off = api.events.onAIReviewChunk((chunk) => {
      if (chunk.prNumber !== prNumber) return;
      streamedRef.current += chunk.text;
      setStreamed(streamedRef.current);
    });
    return off;
  }, [prNumber]);

  if (collapsed) return null;

  const finalSummary = reviewM.data?.summary ?? '';
  const showStreaming = reviewM.isPending && streamed.length > 0;
  const showError = !!reviewM.error;
  const apiError = reviewM.error as ApiError | undefined;
  const authBlocked = authQ.data?.available === false;

  return (
    <aside className="w-[360px] shrink-0 border-l border-border-muted bg-canvas-subtle/30 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2 text-2xs uppercase tracking-wide text-fg-subtle">
          <span>AI review</span>
          {authQ.data?.source === 'claude-code' && (
            <span className="text-fg-muted normal-case tracking-normal" title="Using local Claude Code credentials">
              · claude code
            </span>
          )}
          {authQ.data?.source === 'api-key' && (
            <span className="text-fg-muted normal-case tracking-normal" title="Using ANTHROPIC_API_KEY">
              · api key
            </span>
          )}
        </div>
        <button
          onClick={toggle}
          className="text-2xs text-fg-subtle hover:text-fg"
          title="Hide panel"
        >
          ‹
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {authBlocked ? (
          <AuthMissing />
        ) : reviewM.isPending && streamed.length === 0 ? (
          <Status text="Asking Claude…" />
        ) : showStreaming ? (
          <Markdown text={streamed} streaming />
        ) : reviewM.isSuccess ? (
          <Markdown text={finalSummary} />
        ) : showError ? (
          <ErrorBox error={apiError!} />
        ) : (
          <Idle />
        )}
      </div>

      <div className="border-t border-border-muted p-3 shrink-0 flex items-center gap-2">
        <button
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => reviewM.mutate()}
          disabled={reviewM.isPending || authBlocked}
        >
          {reviewM.isPending
            ? 'Reviewing…'
            : reviewM.isSuccess || showError
              ? 'Re-run AI review'
              : 'Run AI review'}
        </button>
        {reviewM.data?.costUSD != null && reviewM.data.costUSD > 0 && (
          <span
            className="text-2xs text-fg-subtle"
            title={
              authQ.data?.source === 'claude-code'
                ? 'API-equivalent value of tokens used. Covered by your Claude subscription — not billed.'
                : 'Billed via ANTHROPIC_API_KEY.'
            }
          >
            {authQ.data?.source === 'claude-code' ? '≈ ' : ''}${reviewM.data.costUSD.toFixed(4)}
            {authQ.data?.source === 'claude-code' && (
              <span className="ml-1 text-fg-subtle/70">API-eq.</span>
            )}
          </span>
        )}
      </div>
    </aside>
  );
}

function Idle() {
  return (
    <div className="text-sm text-fg-muted leading-relaxed">
      <p>
        Run an on-demand review of this PR with Claude. The model is sent the
        diff and PR description; it has no tool access and cannot read other
        files.
      </p>
      <p className="mt-2 text-2xs text-fg-subtle">
        Returns a markdown summary with Overview · Concerns · Suggestions.
      </p>
    </div>
  );
}

function Status({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fg-muted">
      <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
      {text}
    </div>
  );
}

function AuthMissing() {
  return (
    <div className="text-sm text-fg-muted leading-relaxed">
      <div className="text-danger text-2xs uppercase tracking-wide mb-2">
        Not authenticated
      </div>
      <p>Claude is not authenticated on this machine.</p>
      <p className="mt-2">
        Either sign in with <code className="font-mono text-fg">claude</code> on
        the command line, or set <code className="font-mono text-fg">ANTHROPIC_API_KEY</code> in
        your shell before launching the app.
      </p>
    </div>
  );
}

function ErrorBox({ error }: { error: ApiError }) {
  return (
    <div className="rounded-md border border-danger-emphasis/40 bg-danger-subtle px-3 py-2 text-sm text-danger">
      <div className="text-2xs uppercase tracking-wide mb-1">{error.code}</div>
      <div className="whitespace-pre-wrap">{error.message}</div>
    </div>
  );
}

function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="ai-md text-sm text-fg leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h2 className="text-base font-semibold mt-3 mb-2 text-fg" {...p} />,
          h2: (p) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-fg" {...p} />,
          h3: (p) => <h4 className="text-sm font-semibold mt-2 mb-1 text-fg" {...p} />,
          p: (p) => <p className="mb-2 text-fg" {...p} />,
          ul: (p) => <ul className="list-disc pl-5 mb-2 space-y-1" {...p} />,
          ol: (p) => <ol className="list-decimal pl-5 mb-2 space-y-1" {...p} />,
          li: (p) => <li className="text-fg" {...p} />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? '');
            return isBlock ? (
              <code className="block bg-canvas-overlay border border-border-muted rounded px-2 py-1.5 text-2xs font-mono overflow-x-auto whitespace-pre" {...rest}>
                {children}
              </code>
            ) : (
              <code className="font-mono text-2xs bg-canvas-overlay px-1 py-0.5 rounded text-fg" {...rest}>
                {children}
              </code>
            );
          },
          pre: (p) => <pre className="mb-2 not-prose" {...p} />,
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
