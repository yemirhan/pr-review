import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError, qk, unwrap } from '../lib/api';
import { useUI, AI_PANEL_WIDTH_MIN, AI_PANEL_WIDTH_MAX } from '../store/ui';
import { DiffViewer } from './DiffViewer';
import type {
  AIApplyPreflight,
  AIApplyProgress,
  AIApplyResult,
  AIChatMessage,
  AIReviewMode
} from '@shared/types';

interface Props {
  repoId: string;
  prNumber: number;
  headOid: string;
  onRequestCheckout?: () => void;
  checkoutSuccessNonce?: number;
}

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'preflighting' }
  | { kind: 'wrong-branch'; preflight: AIApplyPreflight }
  | { kind: 'dirty' }
  | { kind: 'applying'; events: AIApplyProgress[] }
  | { kind: 'applied'; result: AIApplyResult; commitMessage: string }
  | { kind: 'pushing'; result: AIApplyResult; commitMessage: string }
  | { kind: 'pushed' }
  | { kind: 'error'; error: ApiError };

type StreamState =
  | null
  | { kind: 'review'; streamId: string; text: string }
  | { kind: 'chat'; streamId: string; text: string; pendingUser: string };

interface Session {
  id: string;
  /** User-facing label. Updates to the mode label after first review. */
  name: string;
  mode: AIReviewMode;
  includeClickUp: boolean;
  review: { mode: AIReviewMode; text: string } | null;
  chat: AIChatMessage[];
  draftMsg: string;
  stream: StreamState;
  applyState: ApplyState;
  error: ApiError | null;
}

interface ModeInfo {
  key: AIReviewMode;
  label: string;
  blurb: string;
}

const MODES: ModeInfo[] = [
  { key: 'critique', label: 'Critique', blurb: 'Concerns + suggestions' },
  { key: 'summary', label: 'Summary', blurb: 'What changed, in plain English' },
  { key: 'recap', label: 'Recap', blurb: 'What the author did' },
  { key: 'risk', label: 'Risk', blurb: 'What could break' },
  { key: 'tests', label: 'Tests', blurb: 'Coverage & gaps' }
];

const modeLabel = (m: AIReviewMode) => MODES.find((x) => x.key === m)?.label ?? m;

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeSession(label: string): Session {
  return {
    id: genId(),
    name: label,
    mode: 'critique',
    includeClickUp: false,
    review: null,
    chat: [],
    draftMsg: '',
    stream: null,
    applyState: { kind: 'idle' },
    error: null
  };
}

export function AIReviewPanel({
  repoId,
  prNumber,
  headOid,
  onRequestCheckout,
  checkoutSuccessNonce
}: Props) {
  const collapsed = useUI((s) => s.aiPanelCollapsed);
  const toggle = useUI((s) => s.toggleAIPanel);
  const width = useUI((s) => s.aiPanelWidth);
  const setWidth = useUI((s) => s.setAIPanelWidth);
  const [dragging, setDragging] = useState(false);

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setDragging(true);
    function onMove(ev: PointerEvent) {
      // Panel is anchored to the right; dragging left grows it.
      const next = startW + (startX - ev.clientX);
      setWidth(next);
    }
    function onUp() {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const [sessions, setSessions] = useState<Session[]>(() => [makeSession('Chat 1')]);
  const [activeId, setActiveId] = useState<string>(sessions[0].id);
  const [nextChatNumber, setNextChatNumber] = useState(2);

  // Ref mirror so async handlers see fresh state.
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const authQ = useQuery({
    queryKey: qk.aiAuth,
    queryFn: () => unwrap(api.ai.authStatus()),
    staleTime: 60_000
  });

  // Reset all sessions when switching PRs.
  useEffect(() => {
    const fresh = makeSession('Chat 1');
    setSessions([fresh]);
    setActiveId(fresh.id);
    setNextChatNumber(2);
  }, [repoId, prNumber]);

  // Route streaming chunks to whichever session is currently streaming with
  // a matching streamId.
  useEffect(() => {
    const off = api.events.onAIReviewChunk((chunk) => {
      if (chunk.prNumber !== prNumber) return;
      setSessions((cur) =>
        cur.map((s) =>
          s.stream && s.stream.streamId === chunk.streamId
            ? { ...s, stream: { ...s.stream, text: s.stream.text + chunk.text } }
            : s
        )
      );
    });
    return off;
  }, [prNumber]);

  // Apply progress events route to whichever session is in 'applying' state.
  useEffect(() => {
    const off = api.events.onAIApplyProgress((event) => {
      if (event.kind === 'text') return;
      setSessions((cur) =>
        cur.map((s) =>
          s.applyState.kind === 'applying'
            ? {
                ...s,
                applyState: {
                  kind: 'applying',
                  events: [...s.applyState.events, event]
                }
              }
            : s
        )
      );
    });
    return off;
  }, []);

  function updateSession(id: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) {
    setSessions((cur) =>
      cur.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s))
    );
  }

  function addSession() {
    const s = makeSession(`Chat ${nextChatNumber}`);
    setNextChatNumber((n) => n + 1);
    setSessions((cur) => [...cur, s]);
    setActiveId(s.id);
  }

  function closeSession(id: string) {
    setSessions((cur) => {
      if (cur.length === 1) {
        // Always keep at least one — reset it instead.
        const fresh = makeSession('Chat 1');
        setActiveId(fresh.id);
        setNextChatNumber(2);
        return [fresh];
      }
      const idx = cur.findIndex((s) => s.id === id);
      const next = cur.filter((s) => s.id !== id);
      if (id === activeId) {
        const fallback = next[Math.min(idx, next.length - 1)];
        setActiveId(fallback.id);
      }
      return next;
    });
  }

  async function runReview(sessionId: string, chosenMode: AIReviewMode) {
    const streamId = genId();
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session) return;
    updateSession(sessionId, {
      stream: { kind: 'review', streamId, text: '' },
      error: null
    });
    try {
      const r = await unwrap(
        api.ai.review(
          repoId,
          prNumber,
          { mode: chosenMode, includeClickUpTask: session.includeClickUp },
          streamId
        )
      );
      updateSession(sessionId, (cur) => ({
        review: { mode: chosenMode, text: r.summary },
        mode: chosenMode,
        // Rename the tab to the mode label on first review.
        name: cur.review ? cur.name : modeLabel(chosenMode),
        chat: [],
        stream: null,
        applyState: { kind: 'idle' }
      }));
    } catch (e) {
      updateSession(sessionId, { error: e as ApiError, stream: null });
    }
  }

  async function runChat(sessionId: string, message: string) {
    const session = sessionsRef.current.find((s) => s.id === sessionId);
    if (!session) return;
    const streamId = genId();
    const history = composeHistory(session.review, session.chat);
    updateSession(sessionId, {
      stream: { kind: 'chat', streamId, text: '', pendingUser: message },
      error: null,
      draftMsg: ''
    });
    try {
      const r = await unwrap(
        api.ai.chat(repoId, prNumber, {
          history,
          message,
          includeClickUpTask: session.includeClickUp,
          streamId
        })
      );
      updateSession(sessionId, (cur) => ({
        chat: [
          ...cur.chat,
          { role: 'user', content: message },
          { role: 'assistant', content: r.reply }
        ],
        stream: null
      }));
    } catch (e) {
      updateSession(sessionId, { error: e as ApiError, stream: null });
    }
  }

  // ----- Apply suggestions (scoped to the active session's last review) -----

  async function runApply(sessionId: string, reviewText: string) {
    updateSession(sessionId, { applyState: { kind: 'preflighting' } });
    try {
      const pre = await unwrap(api.ai.applyPreflight(repoId, prNumber));
      if (!pre.branchMatches) {
        updateSession(sessionId, { applyState: { kind: 'wrong-branch', preflight: pre } });
        return;
      }
      if (pre.dirty) {
        updateSession(sessionId, { applyState: { kind: 'dirty' } });
        return;
      }
      updateSession(sessionId, { applyState: { kind: 'applying', events: [] } });
      const result = await unwrap(api.ai.apply(repoId, prNumber, reviewText));
      updateSession(sessionId, {
        applyState: { kind: 'applied', result, commitMessage: result.commitMessage }
      });
    } catch (e) {
      updateSession(sessionId, { applyState: { kind: 'error', error: e as ApiError } });
    }
  }

  async function runPush(sessionId: string) {
    const s = sessionsRef.current.find((x) => x.id === sessionId);
    if (!s || s.applyState.kind !== 'applied') return;
    const { result, commitMessage } = s.applyState;
    updateSession(sessionId, { applyState: { kind: 'pushing', result, commitMessage } });
    try {
      await unwrap(api.ai.push(repoId, commitMessage));
      updateSession(sessionId, { applyState: { kind: 'pushed' } });
    } catch (e) {
      updateSession(sessionId, { applyState: { kind: 'error', error: e as ApiError } });
    }
  }

  async function runDiscard(sessionId: string) {
    const s = sessionsRef.current.find((x) => x.id === sessionId);
    if (!s || s.applyState.kind !== 'applied') return;
    try {
      await unwrap(api.ai.discard(repoId, s.applyState.result.untrackedBefore));
      updateSession(sessionId, { applyState: { kind: 'idle' } });
    } catch (e) {
      updateSession(sessionId, { applyState: { kind: 'error', error: e as ApiError } });
    }
  }

  // Auto-retry apply after a successful checkout, if any session is waiting.
  useEffect(() => {
    if (!checkoutSuccessNonce) return;
    const waiter = sessionsRef.current.find(
      (s) => s.applyState.kind === 'wrong-branch' && s.review
    );
    if (waiter) runApply(waiter.id, waiter.review!.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutSuccessNonce]);

  if (collapsed) return null;

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const authBlocked = authQ.data?.available === false;

  return (
    <aside
      className="relative shrink-0 border-l border-border-muted bg-canvas-subtle/30 flex flex-col min-h-0"
      style={{ width: `${width}px` }}
    >
      <div
        onPointerDown={startResize}
        className={`absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-10 group ${
          dragging ? '' : ''
        }`}
        title={`Drag to resize (${AI_PANEL_WIDTH_MIN}–${AI_PANEL_WIDTH_MAX}px)`}
        role="separator"
        aria-orientation="vertical"
      >
        <div
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${
            dragging ? 'bg-accent w-0.5' : 'bg-transparent group-hover:bg-accent/60'
          }`}
        />
      </div>
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
        <button onClick={toggle} className="text-2xs text-fg-subtle hover:text-fg" title="Hide panel">
          ‹
        </button>
      </div>

      <SessionTabs
        sessions={sessions}
        activeId={active.id}
        onSelect={setActiveId}
        onClose={closeSession}
        onAdd={addSession}
      />

      {authBlocked ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <AuthMissing />
        </div>
      ) : (
        <SessionPane
          key={active.id}
          session={active}
          repoId={repoId}
          prNumber={prNumber}
          headOid={headOid}
          onRunReview={(m) => runReview(active.id, m)}
          onRunChat={(msg) => runChat(active.id, msg)}
          onPatch={(p) => updateSession(active.id, p)}
          onRunApply={() => active.review && runApply(active.id, active.review.text)}
          onPushApply={() => runPush(active.id)}
          onDiscardApply={() => runDiscard(active.id)}
          onResetApply={() => updateSession(active.id, { applyState: { kind: 'idle' } })}
          onCheckoutRequest={onRequestCheckout}
        />
      )}
    </aside>
  );
}

function composeHistory(
  review: { mode: AIReviewMode; text: string } | null,
  chat: AIChatMessage[]
): AIChatMessage[] {
  const history: AIChatMessage[] = [];
  if (review) {
    history.push({
      role: 'assistant',
      content: `Initial ${review.mode} review:\n\n${review.text}`
    });
  }
  history.push(...chat);
  return history;
}

// -- Session tabs ----------------------------------------------------------

function SessionTabs({
  sessions,
  activeId,
  onSelect,
  onClose,
  onAdd
}: {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-stretch border-b border-border-muted bg-canvas-inset/30 shrink-0 min-h-[30px] overflow-x-auto">
      {sessions.map((s) => {
        const active = s.id === activeId;
        const busy = !!s.stream;
        return (
          <div
            key={s.id}
            className={`group flex items-center gap-1.5 pl-2.5 pr-1 border-r border-border-muted text-2xs cursor-pointer select-none max-w-[140px] ${
              active
                ? 'bg-canvas text-fg'
                : 'text-fg-muted hover:text-fg hover:bg-canvas-inset/50'
            }`}
            onClick={() => onSelect(s.id)}
            title={s.name}
          >
            {busy && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            )}
            <span className="truncate">{s.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(s.id);
              }}
              className="opacity-0 group-hover:opacity-100 hover:bg-canvas-overlay rounded w-4 h-4 flex items-center justify-center text-fg-subtle hover:text-fg shrink-0"
              title="Close chat"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="px-2 text-fg-subtle hover:text-fg hover:bg-canvas-inset/50 text-sm shrink-0"
        title="New chat"
      >
        +
      </button>
    </div>
  );
}

// -- Per-session pane ------------------------------------------------------

function SessionPane({
  session,
  repoId,
  prNumber,
  headOid,
  onRunReview,
  onRunChat,
  onPatch,
  onRunApply,
  onPushApply,
  onDiscardApply,
  onResetApply,
  onCheckoutRequest
}: {
  session: Session;
  repoId: string;
  prNumber: number;
  headOid: string;
  onRunReview: (m: AIReviewMode) => void;
  onRunChat: (msg: string) => void;
  onPatch: (p: Partial<Session>) => void;
  onRunApply: () => void;
  onPushApply: () => void;
  onDiscardApply: () => void;
  onResetApply: () => void;
  onCheckoutRequest?: () => void;
}) {
  const busy = !!session.stream;
  const reviewing = session.stream?.kind === 'review';
  const chatting = session.stream?.kind === 'chat';

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        <ModeBar
          mode={session.mode}
          onChange={(m) => onPatch({ mode: m })}
          disabled={busy}
          includeClickUp={session.includeClickUp}
          onToggleClickUp={() => onPatch({ includeClickUp: !session.includeClickUp })}
          onRun={() => onRunReview(session.mode)}
          busy={busy}
          hasReview={!!session.review}
        />

        {reviewing && (
          <Markdown
            text={session.stream?.text ?? ''}
            streaming
            emptyPlaceholder="Asking Claude…"
          />
        )}

        {!reviewing && session.review && (
          <>
            <Markdown text={session.review.text} />
            {session.review.mode === 'critique' && (
              <ApplyArea
                applyState={session.applyState}
                repoId={repoId}
                prNumber={prNumber}
                headOid={headOid}
                onRun={onRunApply}
                onPush={onPushApply}
                onDiscard={onDiscardApply}
                onCheckoutRequest={onCheckoutRequest}
                onCommitMessageChange={(msg) => {
                  if (session.applyState.kind === 'applied')
                    onPatch({ applyState: { ...session.applyState, commitMessage: msg } });
                }}
                onReset={onResetApply}
              />
            )}

            <ChatThread
              messages={session.chat}
              streaming={
                chatting && session.stream?.kind === 'chat'
                  ? { text: session.stream.text, pendingUser: session.stream.pendingUser }
                  : null
              }
            />
          </>
        )}

        {!reviewing && !session.review && !session.error && <Idle />}

        {session.error && <ErrorBox error={session.error} />}
      </div>

      {session.review && (
        <div className="border-t border-border-muted p-3 shrink-0">
          <ChatComposer
            value={session.draftMsg}
            onChange={(v) => onPatch({ draftMsg: v })}
            disabled={busy}
            onSend={() => {
              const msg = session.draftMsg.trim();
              if (!msg) return;
              onRunChat(msg);
            }}
          />
        </div>
      )}
    </>
  );
}

function ModeBar({
  mode,
  onChange,
  onRun,
  busy,
  hasReview,
  includeClickUp,
  onToggleClickUp,
  disabled
}: {
  mode: AIReviewMode;
  onChange: (m: AIReviewMode) => void;
  onRun: () => void;
  busy: boolean;
  hasReview: boolean;
  includeClickUp: boolean;
  onToggleClickUp: () => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">Mode</div>
      <div className="grid grid-cols-2 gap-1.5">
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <button
              key={m.key}
              onClick={() => onChange(m.key)}
              disabled={disabled}
              className={`text-left px-2.5 py-1.5 rounded-md border text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                active
                  ? 'border-accent bg-accent-subtle/40 text-fg'
                  : 'border-border-muted text-fg-muted hover:text-fg hover:border-border'
              }`}
              title={m.blurb}
            >
              <div className="font-medium">{m.label}</div>
              <div className="text-2xs text-fg-subtle truncate">{m.blurb}</div>
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-2xs text-fg-muted cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeClickUp}
          onChange={onToggleClickUp}
          disabled={disabled}
          className="accent-accent"
        />
        Include linked ClickUp task as context
      </label>
      <button
        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onRun}
        disabled={busy}
      >
        {busy ? 'Running…' : hasReview ? `Re-run ${modeLabel(mode)}` : `Run ${modeLabel(mode)}`}
      </button>
    </div>
  );
}

function ChatThread({
  messages,
  streaming
}: {
  messages: AIChatMessage[];
  streaming: { text: string; pendingUser: string } | null;
}) {
  if (messages.length === 0 && !streaming) return null;
  return (
    <div className="border-t border-border-muted pt-3 space-y-3">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle">Chat</div>
      {messages.map((m, i) => (
        <ChatBubble key={i} role={m.role} content={m.content} />
      ))}
      {streaming && (
        <>
          <ChatBubble role="user" content={streaming.pendingUser} />
          <ChatBubble role="assistant" content={streaming.text} streaming />
        </>
      )}
    </div>
  );
}

function ChatBubble({
  role,
  content,
  streaming
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}) {
  if (role === 'user') {
    return (
      <div className="rounded-md bg-accent-subtle/30 border border-accent/30 px-3 py-2">
        <div className="text-2xs uppercase tracking-wide text-accent mb-1">You</div>
        <div className="whitespace-pre-wrap text-sm text-fg">{content}</div>
      </div>
    );
  }
  return (
    <div className="rounded-md bg-canvas/40 border border-border-muted px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle mb-1">Claude</div>
      <Markdown
        text={content}
        streaming={streaming}
        emptyPlaceholder={streaming ? 'Thinking…' : undefined}
      />
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSend,
  disabled
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (!disabled) onSend();
          }
        }}
        placeholder="Ask Claude about this PR…"
        rows={2}
        disabled={disabled}
        className="w-full bg-canvas border border-border-muted rounded-md px-2 py-1.5 text-sm text-fg outline-none focus:border-accent resize-y min-h-[3rem] disabled:opacity-60"
      />
      <div className="flex items-center justify-between">
        <span className="text-2xs text-fg-subtle">⌘+Enter to send</span>
        <button
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onSend}
          disabled={disabled || !value.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

interface ApplyAreaProps {
  applyState: ApplyState;
  repoId: string;
  prNumber: number;
  headOid: string;
  onRun: () => void;
  onPush: () => void;
  onDiscard: () => void;
  onReset: () => void;
  onCheckoutRequest?: () => void;
  onCommitMessageChange: (msg: string) => void;
}

function ApplyArea({
  applyState,
  repoId,
  prNumber,
  headOid,
  onRun,
  onPush,
  onDiscard,
  onReset,
  onCheckoutRequest,
  onCommitMessageChange
}: ApplyAreaProps) {
  return (
    <div className="mt-4 pt-4 border-t border-border-muted">
      <div className="text-2xs uppercase tracking-wide text-fg-subtle mb-2">
        Apply suggestions
      </div>

      {applyState.kind === 'idle' && (
        <>
          <p className="text-sm text-fg-muted mb-2 leading-relaxed">
            Run Claude with edit access to apply the suggestions above. The PR
            must be checked out locally with a clean working tree.
          </p>
          <button className="btn-primary" onClick={onRun}>
            Apply changes
          </button>
        </>
      )}

      {applyState.kind === 'preflighting' && <Status text="Checking working tree…" />}

      {applyState.kind === 'wrong-branch' && (
        <div className="text-sm text-fg-muted leading-relaxed space-y-2">
          <p>
            Repo is on <code className="font-mono text-fg">{applyState.preflight.currentBranch}</code>,
            but the PR head is the PR's own branch. Check out the PR first.
          </p>
          {onCheckoutRequest && (
            <button className="btn-primary" onClick={onCheckoutRequest}>
              Checkout PR locally
            </button>
          )}
          <button className="btn ml-2" onClick={onReset}>
            Cancel
          </button>
        </div>
      )}

      {applyState.kind === 'dirty' && (
        <div className="text-sm text-fg-muted leading-relaxed space-y-2">
          <p>
            Your working tree has uncommitted changes. Commit or stash them
            before applying AI changes — we won't touch existing work.
          </p>
          <button className="btn" onClick={onReset}>
            Dismiss
          </button>
        </div>
      )}

      {applyState.kind === 'applying' && (
        <div className="text-sm space-y-2">
          <Status text="Claude is editing files…" />
          {applyState.events.length > 0 && (
            <ul className="space-y-1 text-2xs text-fg-muted font-mono max-h-40 overflow-y-auto border border-border-muted rounded p-2 bg-canvas/40">
              {applyState.events.map((e, i) =>
                e.kind === 'tool' ? (
                  <li key={i} className="flex gap-2">
                    <span className="text-accent shrink-0">{e.name}</span>
                    <span className="truncate text-fg">{e.path ?? ''}</span>
                  </li>
                ) : null
              )}
            </ul>
          )}
        </div>
      )}

      {(applyState.kind === 'applied' || applyState.kind === 'pushing') && (
        <div className="space-y-3">
          {applyState.result.assistantText && (
            <Markdown text={applyState.result.assistantText} />
          )}
          <div>
            <div className="text-2xs uppercase tracking-wide text-fg-subtle mb-1">
              Changes ({applyState.result.diff.length}{' '}
              {applyState.result.diff.length === 1 ? 'file' : 'files'})
            </div>
            <div className="border border-border-muted rounded-md overflow-hidden max-h-[420px] flex flex-col">
              <DiffViewer
                loading={false}
                error={null}
                files={applyState.result.diff}
                threads={[]}
                repoId={repoId}
                prNumber={prNumber}
                headOid={headOid}
              />
            </div>
          </div>
          <div>
            <label className="text-2xs uppercase tracking-wide text-fg-subtle block mb-1">
              Commit message
            </label>
            <textarea
              className="w-full bg-canvas border border-border-muted rounded-md px-2 py-1.5 text-sm font-mono text-fg resize-y min-h-[2.5rem]"
              value={applyState.commitMessage}
              onChange={(e) => onCommitMessageChange(e.target.value)}
              disabled={applyState.kind === 'pushing'}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onPush}
              disabled={
                applyState.kind === 'pushing' ||
                applyState.commitMessage.trim().length === 0 ||
                applyState.result.diff.length === 0
              }
            >
              {applyState.kind === 'pushing' ? 'Pushing…' : 'Push to branch'}
            </button>
            <button
              className="btn disabled:opacity-50"
              onClick={onDiscard}
              disabled={applyState.kind === 'pushing'}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {applyState.kind === 'pushed' && (
        <div className="text-sm text-success">
          Pushed to branch.
          <button className="btn ml-2" onClick={onReset}>
            Done
          </button>
        </div>
      )}

      {applyState.kind === 'error' && (
        <div className="space-y-2">
          <ErrorBox error={applyState.error} />
          <button className="btn" onClick={onReset}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function Idle() {
  return (
    <div className="text-sm text-fg-muted leading-relaxed">
      <p>
        Pick a mode above and click Run. Claude is sent the diff and PR
        description (and optionally the linked ClickUp task) — it has no tool
        access and cannot read other files.
      </p>
      <p className="mt-2 text-2xs text-fg-subtle">
        After the review, ask follow-up questions in the chat below. Open more
        chats with the + tab.
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
        Either sign in with <code className="font-mono text-fg">claude</code> on the command
        line, or set <code className="font-mono text-fg">ANTHROPIC_API_KEY</code> in your shell
        before launching the app.
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

function Markdown({
  text,
  streaming,
  emptyPlaceholder
}: {
  text: string;
  streaming?: boolean;
  emptyPlaceholder?: string;
}) {
  if (!text && emptyPlaceholder) {
    return <Status text={emptyPlaceholder} />;
  }
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
              <code
                className="block bg-canvas-overlay border border-border-muted rounded px-2 py-1.5 text-2xs font-mono overflow-x-auto whitespace-pre"
                {...rest}
              >
                {children}
              </code>
            ) : (
              <code
                className="font-mono text-2xs bg-canvas-overlay px-1 py-0.5 rounded text-fg"
                {...rest}
              >
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
