import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus, Settings2, Square, X } from 'lucide-react';
import { api, ApiError, qk, unwrap } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAISession, visibleFindings } from '../../lib/aiSessions';
import { useUI, AI_PANEL_WIDTH_MIN, AI_PANEL_WIDTH_MAX } from '../../store/ui';
import { usePanelResize } from '../../lib/panelResize';
import { Spinner } from '../ui/spinner';
import { ApplyFlow } from './ApplyFlow';
import { Markdown, Pulse } from './Markdown';
import { SEVERITY_DOT, SEVERITY_LABEL } from './severity';
import { useFindingActions } from './useFindingActions';
import type {
  AIAuthStatus,
  AIProvider,
  AIReviewDepth,
  AIReviewFinding,
  AISession
} from '@shared/types';

export interface JumpTarget {
  path: string;
  line: number | null;
  startLine?: number;
  side: 'LEFT' | 'RIGHT';
  findingId?: string;
}

interface Props {
  repoId: string;
  prNumber: number;
  /** Current PR head; a review of an older head is shown as stale. */
  headOid: string;
  onJumpTo: (target: JumpTarget) => void;
  onRequestCheckout?: () => void;
  checkoutSuccessNonce?: number;
}

const PROVIDER_LABEL: Record<AIProvider, string> = { claude: 'Claude', codex: 'Codex' };

const CHAT_PROMPTS = [
  'Summarize this PR for someone who has not seen it.',
  'What could break in production after this merges?',
  'Which tests are missing for this change?'
];

function useElapsed(since: number, running: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return formatDuration((running ? now : since) - since);
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * The AI review side panel. The review itself lives in the main process;
 * this is a view over it, so hiding the panel or switching PRs never loses
 * or cancels anything. Hidden with CSS (not unmounted) to keep local state.
 */
export function AIPanel(props: Props) {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);
  const width = useUI((s) => s.aiPanelWidth);
  const setWidth = useUI((s) => s.setAIPanelWidth);
  const openSettings = useUI((s) => s.openSettings);
  const { panelRef, dragging, startResize } = usePanelResize<HTMLElement>({
    width,
    min: AI_PANEL_WIDTH_MIN,
    max: AI_PANEL_WIDTH_MAX,
    direction: -1,
    onCommit: setWidth
  });

  return (
    <aside
      ref={panelRef}
      className={cn(
        'relative shrink-0 border-l border-border-muted bg-canvas flex flex-col min-h-0',
        collapsed && 'hidden'
      )}
      style={{ width: `${width}px` }}
    >
      <div
        onPointerDown={startResize}
        className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-10 group"
        title={`Drag to resize (${AI_PANEL_WIDTH_MIN}–${AI_PANEL_WIDTH_MAX}px)`}
        role="separator"
        aria-orientation="vertical"
      >
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors',
            dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/60'
          )}
        />
      </div>
      <div className="flex items-center gap-2 pl-4 pr-2 h-10 border-b border-border-muted shrink-0">
        <span className="text-sm font-medium text-fg">AI review</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={() => openSettings('ai')} className="btn-icon h-7 w-7" title="AI settings">
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={toggle} className="btn-icon h-7 w-7" title="Hide panel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <PanelBody key={`${props.repoId}:${props.prNumber}`} {...props} />
    </aside>
  );
}

function PanelBody({ repoId, prNumber, headOid, onJumpTo, onRequestCheckout, checkoutSuccessNonce }: Props) {
  const qc = useQueryClient();
  const sessionQ = useAISession(repoId, prNumber);
  const session = sessionQ.data ?? null;
  const cfgQ = useQuery({ queryKey: qk.aiConfig, queryFn: () => unwrap(api.ai.getConfig()) });
  const provider: AIProvider = cfgQ.data?.provider ?? 'codex';
  const depth: AIReviewDepth = cfgQ.data?.depth ?? 'thorough';
  const authQ = useQuery({
    queryKey: qk.aiAuth(provider),
    queryFn: () => unwrap(api.ai.authStatus(provider)),
    staleTime: 60_000,
    enabled: !!cfgQ.data
  });
  const [startError, setStartError] = useState<ApiError | null>(null);

  async function setPrefs(patch: { provider?: AIProvider; depth?: AIReviewDepth }) {
    const next = await unwrap(api.ai.setConfig(patch));
    qc.setQueryData(qk.aiConfig, next);
  }

  async function start() {
    setStartError(null);
    try {
      const s = await unwrap(api.ai.startReview(repoId, prNumber, { provider, depth }));
      qc.setQueryData(qk.aiSession(repoId, prNumber), s);
    } catch (e) {
      setStartError(e as ApiError);
    }
  }

  const running = session?.status === 'running';

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-3 space-y-4">
          {!session && (
            <Launcher
              provider={provider}
              depth={depth}
              auth={authQ.data}
              onProvider={(p) => void setPrefs({ provider: p })}
              onDepth={(d) => void setPrefs({ depth: d })}
              onStart={start}
              onRetryAuth={() => authQ.refetch()}
            />
          )}
          {startError && <div className="text-sm text-danger">{startError.message}</div>}
          {session && (
            <SessionView
              session={session}
              headOid={headOid}
              provider={provider}
              depth={depth}
              onProvider={(p) => void setPrefs({ provider: p })}
              onDepth={(d) => void setPrefs({ depth: d })}
              onRerun={start}
              onJumpTo={onJumpTo}
              onRequestCheckout={onRequestCheckout}
              checkoutSuccessNonce={checkoutSuccessNonce}
            />
          )}
        </div>
      </div>
      {session && !running && <ChatComposer session={session} />}
    </>
  );
}

// ---------------------------------------------------------------------------

function ProviderPicker({
  provider,
  depth,
  onProvider,
  onDepth
}: {
  provider: AIProvider;
  depth: AIReviewDepth;
  onProvider: (p: AIProvider) => void;
  onDepth: (d: AIReviewDepth) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="segmented" role="group" aria-label="Provider">
        {(['claude', 'codex'] as AIProvider[]).map((p) => (
          <button key={p} aria-pressed={provider === p} onClick={() => onProvider(p)}>
            {PROVIDER_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Depth">
        {(['quick', 'thorough'] as AIReviewDepth[]).map((d) => (
          <button key={d} aria-pressed={depth === d} onClick={() => onDepth(d)}>
            {d === 'quick' ? 'Quick' : 'Thorough'}
          </button>
        ))}
      </div>
    </div>
  );
}

function Launcher({
  provider,
  depth,
  auth,
  onProvider,
  onDepth,
  onStart,
  onRetryAuth
}: {
  provider: AIProvider;
  depth: AIReviewDepth;
  auth: AIAuthStatus | undefined;
  onProvider: (p: AIProvider) => void;
  onDepth: (d: AIReviewDepth) => void;
  onStart: () => void;
  onRetryAuth: () => void;
}) {
  const blocked = auth?.available === false;
  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm text-fg-muted leading-relaxed">
        The reviewer works in a read-only checkout of this PR, so it can open files, follow callers and check tests
        before it comments. Findings show up on the lines they are about.
      </p>
      <ProviderPicker provider={provider} depth={depth} onProvider={onProvider} onDepth={onDepth} />
      {blocked ? (
        <div className="text-sm text-fg-muted space-y-2">
          <p className="text-danger">{auth?.detail ?? `${PROVIDER_LABEL[provider]} is not signed in.`}</p>
          <p>
            {provider === 'claude' ? (
              <>
                Sign in with <code className="font-mono text-fg">claude</code> or set{' '}
                <code className="font-mono text-fg">ANTHROPIC_API_KEY</code>.
              </>
            ) : (
              <>
                Install the Codex CLI and run <code className="font-mono text-fg">codex login</code>.
              </>
            )}
          </p>
          <button className="btn" onClick={onRetryAuth}>
            Check again
          </button>
        </div>
      ) : (
        <button className="btn-primary w-full" onClick={onStart}>
          Review this PR
        </button>
      )}
      <p className="text-2xs text-fg-subtle">
        {depth === 'thorough'
          ? 'Thorough takes a few minutes on large PRs.'
          : 'Quick uses a faster model and less exploration.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SessionView({
  session: s,
  headOid,
  provider,
  depth,
  onProvider,
  onDepth,
  onRerun,
  onJumpTo,
  onRequestCheckout,
  checkoutSuccessNonce
}: {
  session: AISession;
  headOid: string;
  provider: AIProvider;
  depth: AIReviewDepth;
  onProvider: (p: AIProvider) => void;
  onDepth: (d: AIReviewDepth) => void;
  onRerun: () => void;
  onJumpTo: (t: JumpTarget) => void;
  onRequestCheckout?: () => void;
  checkoutSuccessNonce?: number;
}) {
  const running = s.status === 'running';
  const elapsed = useElapsed(s.startedAt, running);
  const stale = !running && !!s.headOid && s.headOid !== headOid;
  const [rerunOpen, setRerunOpen] = useState(false);
  const visible = visibleFindings(s);
  const { addedIds, add } = useFindingActions(s.repoId, s.prNumber);
  const addable = visible.filter((f) => !addedIds.has(f.id));

  return (
    <div className="space-y-4">
      {running ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Spinner size="xs" />
            <span className="text-sm text-fg">
              {PROVIDER_LABEL[s.provider]} is reviewing
              {s.findings.length > 0 && (
                <span className="text-fg-muted">
                  {' '}
                  · {s.findings.length} {s.findings.length === 1 ? 'finding' : 'findings'} so far
                </span>
              )}
            </span>
            <span className="ml-auto text-2xs text-fg-subtle tabular-nums">{elapsed}</span>
            <button
              className="btn-ghost h-6 px-1.5 text-2xs"
              onClick={() => void api.ai.cancelReview(s.repoId, s.prNumber)}
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          </div>
          {s.progress.length > 0 && (
            <ul className="text-2xs font-mono text-fg-subtle space-y-0.5 pl-6">
              {s.progress.slice(-3).map((line, i, arr) => (
                <li key={`${s.progress.length}-${i}`} className={cn('truncate', i === arr.length - 1 && 'text-fg-muted')}>
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {stale && (
            <div className="flex items-center gap-2 rounded-md bg-attention-subtle px-3 py-2 text-xs text-fg">
              <span className="flex-1">
                Reviewed at <code className="font-mono">{s.headOid.slice(0, 7)}</code>; the PR has new commits.
              </span>
              <button className="btn h-6 text-2xs" onClick={onRerun}>
                Re-review
              </button>
            </div>
          )}
          {s.status === 'error' && s.error && (
            <div className="space-y-2">
              <div className="text-sm text-danger whitespace-pre-wrap">{s.error.message}</div>
              <button className="btn" onClick={onRerun}>
                Try again
              </button>
            </div>
          )}
          {s.status === 'cancelled' && (
            <div className="text-xs text-fg-subtle">Stopped before finishing; showing what came in.</div>
          )}
        </>
      )}

      {s.verdict && (
        <div className="text-sm text-fg leading-relaxed">
          <Markdown text={s.verdict} />
        </div>
      )}

      {!running && (
        <div className="flex items-center gap-2 flex-wrap">
          {addable.length > 0 && (
            <button className="btn" onClick={() => addable.forEach(add)}>
              <Plus className="h-3.5 w-3.5" />
              Add {addable.length} to review
            </button>
          )}
          <button className="btn-ghost" onClick={() => setRerunOpen((o) => !o)}>
            Re-run
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', rerunOpen && 'rotate-180')} />
          </button>
          <span className="ml-auto text-2xs text-fg-subtle text-right">
            {PROVIDER_LABEL[s.provider]}
            {s.model ? ` · ${s.model}` : ''} · {s.depth}
            {s.durationMs ? ` · ${formatDuration(s.durationMs)}` : ''}
            {s.costUSD ? ` · $${s.costUSD.toFixed(2)}` : ''}
          </span>
        </div>
      )}
      {!running && rerunOpen && (
        <div className="surface p-3 space-y-2.5">
          <ProviderPicker provider={provider} depth={depth} onProvider={onProvider} onDepth={onDepth} />
          <p className="text-2xs text-fg-subtle">
            The new run sees the current findings and your dismissals, so it won't repeat what you rejected.
          </p>
          <button
            className="btn-primary"
            onClick={() => {
              setRerunOpen(false);
              onRerun();
            }}
          >
            Run again
          </button>
        </div>
      )}
      {!running && !s.usedWorktree && s.status === 'done' && (
        <div className="text-2xs text-fg-subtle">
          Reviewed from the diff only; a checkout of the PR could not be prepared.
        </div>
      )}

      <FindingList session={s} onJumpTo={onJumpTo} />

      {s.notes.length > 0 && (
        <section className="space-y-1.5">
          <div className="text-2xs text-fg-subtle">Notes</div>
          <ul className="list-disc pl-4 space-y-1 text-sm text-fg">
            {s.notes.map((n, i) => (
              <li key={i}>
                <Markdown text={n} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.raw && (
        <details className="text-2xs text-fg-subtle">
          <summary className="cursor-pointer">The reply could not be parsed; show raw output</summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-fg-muted max-h-48 overflow-y-auto">{s.raw}</pre>
        </details>
      )}

      {!running && (
        <ApplyFlow
          session={s}
          providerLabel={PROVIDER_LABEL[s.provider]}
          onRequestCheckout={onRequestCheckout}
          checkoutSuccessNonce={checkoutSuccessNonce}
        />
      )}

      <ChatThread session={s} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function FindingList({ session: s, onJumpTo }: { session: AISession; onJumpTo: (t: JumpTarget) => void }) {
  const { addedIds, add, remove, setDismissed } = useFindingActions(s.repoId, s.prNumber);
  const [showDismissed, setShowDismissed] = useState(false);
  const visible = visibleFindings(s);
  const dismissed = s.findings.filter((f) => s.dismissed.includes(f.id));
  const [cursor, setCursor] = useState(-1);

  const groups = useMemo(() => {
    const m = new Map<string, AIReviewFinding[]>();
    for (const f of visible) m.set(f.path, [...(m.get(f.path) ?? []), f]);
    return [...m.entries()];
  }, [visible]);
  const ordered = useMemo(() => groups.flatMap(([, list]) => list), [groups]);

  const jump = (f: AIReviewFinding) =>
    onJumpTo({ path: f.path, line: f.line, startLine: f.startLine, side: f.side, findingId: f.id });

  // n / p step through findings while the panel is open.
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (e.key !== 'n' && e.key !== 'p') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]'))) return;
      if (useUI.getState().aiPanelCollapsed) return;
      const list = orderedRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      setCursor((c) => {
        const next = e.key === 'n' ? (c + 1) % list.length : (c - 1 + list.length) % list.length;
        const f = list[next];
        onJumpTo({ path: f.path, line: f.line, startLine: f.startLine, side: f.side, findingId: f.id });
        return next;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onJumpTo]);

  if (s.status !== 'running' && s.findings.length === 0) {
    return s.status === 'done' ? (
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Check className="h-4 w-4 text-success" /> No findings.
      </div>
    ) : null;
  }

  return (
    <section className="space-y-3">
      {visible.length > 0 && (
        <div className="flex items-center text-2xs text-fg-subtle">
          <span>
            {visible.length} {visible.length === 1 ? 'finding' : 'findings'}
          </span>
          <span className="ml-auto">
            <span className="kbd">n</span> <span className="kbd">p</span> to step through
          </span>
        </div>
      )}
      {groups.map(([path, list]) => (
        <div key={path} className="space-y-1">
          <div className="text-2xs font-mono text-fg-subtle truncate" title={path}>
            {path}
          </div>
          {list.map((f) => {
            const added = addedIds.has(f.id);
            const active = ordered[cursor]?.id === f.id;
            return (
              <div
                key={f.id}
                className={cn(
                  'group rounded-md px-2 py-1.5 -mx-2 hover:bg-canvas-subtle cursor-pointer',
                  active && 'bg-canvas-subtle'
                )}
                onClick={() => {
                  setCursor(ordered.indexOf(f));
                  jump(f);
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn('mt-[7px] h-1.5 w-1.5 rounded-full shrink-0', SEVERITY_DOT[f.severity])}
                    title={SEVERITY_LABEL[f.severity]}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-fg leading-snug">{f.title}</div>
                    <div className="text-2xs text-fg-subtle mt-0.5">
                      {f.line != null ? `line ${f.startLine != null ? `${f.startLine}–` : ''}${f.line}` : 'file'}
                      {f.side === 'LEFT' ? ' (removed)' : ''}
                      {added && <span className="text-accent"> · in your review</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="btn-icon h-6 w-6"
                      title={added ? 'Remove from review' : 'Add to review'}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (added) remove(f);
                        else add(f);
                      }}
                    >
                      {added ? <Check className="h-3.5 w-3.5 text-accent" /> : <Plus className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      className="btn-icon h-6 w-6"
                      title="Dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        void setDismissed(f, true);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {dismissed.length > 0 && (
        <div className="space-y-1">
          <button className="text-2xs text-fg-subtle hover:text-fg" onClick={() => setShowDismissed((v) => !v)}>
            {dismissed.length} dismissed {showDismissed ? '· hide' : '· show'}
          </button>
          {showDismissed &&
            dismissed.map((f) => (
              <div key={f.id} className="flex items-center gap-2 text-xs text-fg-subtle">
                <span className="truncate flex-1 line-through">{f.title}</span>
                <button className="hover:text-fg" onClick={() => void setDismissed(f, false)}>
                  restore
                </button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function ChatThread({ session: s }: { session: AISession }) {
  const titleOf = (id?: string) => (id ? s.findings.find((f) => f.id === id)?.title : undefined);
  if (s.chat.length === 0 && !s.chatStream) return null;
  return (
    <section className="space-y-3 border-t border-border-muted pt-3">
      {s.chat.map((m, i) =>
        m.role === 'user' ? (
          <UserBubble key={i} text={m.content} about={titleOf(m.findingId)} />
        ) : (
          <Markdown key={i} text={m.content} />
        )
      )}
      {s.chatStream && (
        <>
          <UserBubble text={s.chatStream.message} about={titleOf(s.chatStream.findingId)} />
          {!s.chatStream.text && s.chatStream.status && (
            <div className="text-2xs font-mono text-fg-subtle truncate">{s.chatStream.status}</div>
          )}
          <Markdown text={s.chatStream.text} streaming emptyPlaceholder="Thinking…" />
        </>
      )}
    </section>
  );
}

function UserBubble({ text, about }: { text: string; about?: string }) {
  return (
    <div className="ml-6 rounded-lg bg-canvas-subtle px-3 py-2">
      {about && <div className="text-2xs text-fg-subtle mb-0.5 truncate">About: {about}</div>}
      <div className="whitespace-pre-wrap text-sm text-fg">{text}</div>
    </div>
  );
}

function ChatComposer({ session: s }: { session: AISession }) {
  const qc = useQueryClient();
  const askId = useUI((st) => st.aiAskFindingId);
  const clearAsk = useUI((st) => st.askAboutFinding);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const focus = askId ? s.findings.find((f) => f.id === askId) : undefined;
  const busy = !!s.chatStream;

  useEffect(() => {
    if (askId) ref.current?.focus();
  }, [askId]);

  async function send(message: string) {
    const msg = message.trim();
    if (!msg || busy) return;
    setErr(null);
    try {
      const next = await unwrap(api.ai.chat(s.repoId, s.prNumber, msg, focus?.id));
      qc.setQueryData(qk.aiSession(s.repoId, s.prNumber), next);
      setValue('');
      clearAsk(null);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  return (
    <div className="border-t border-border-muted p-3 space-y-2 shrink-0">
      {s.chat.length === 0 && !busy && !focus && (
        <div className="flex flex-wrap gap-1.5">
          {CHAT_PROMPTS.map((p) => (
            <button key={p} className="chip hover:text-fg hover:border-border" onClick={() => void send(p)}>
              {p.replace(/\.$|\?$/, '')}
            </button>
          ))}
        </div>
      )}
      {focus && (
        <div className="flex items-center gap-1.5 text-2xs text-fg-muted">
          <span className="truncate">About: {focus.title}</span>
          <button className="btn-icon h-5 w-5" onClick={() => clearAsk(null)} title="Ask about the whole PR">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      <div className="relative">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(value);
            }
          }}
          placeholder={focus ? 'Is this real? What would you change?' : 'Ask about this PR…'}
          rows={2}
          className="input w-full h-auto py-2 pr-16 resize-none text-sm leading-snug"
        />
        <div className="absolute right-2 bottom-2">
          {busy ? (
            <button
              className="btn-ghost h-6 px-1.5 text-2xs"
              onClick={() => void api.ai.cancelReview(s.repoId, s.prNumber)}
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          ) : (
            <span className="kbd">⏎</span>
          )}
        </div>
      </div>
      {err && <div className="text-2xs text-danger">{err}</div>}
    </div>
  );
}
