import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, qk, unwrap, ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useUI, DIFF_FONT_SIZE_MAX, DIFF_FONT_SIZE_MIN } from '../../store/ui';
import { useAddRepo } from '../Sidebar';
import { Spinner } from '../ui/spinner';
import { Skeleton } from '../ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Group, Page, Row, Segmented, StatusDot, Switch } from './primitives';
import type { AIConfig, SystemTool } from '@shared/types';

// =====================================================================================
// General
// =====================================================================================

export function GeneralSettings() {
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const fontSize = useUI((s) => s.diffFontSize);
  const setFontSize = useUI((s) => s.setDiffFontSize);
  const density = useUI((s) => s.diffDensity);
  const setDensity = useUI((s) => s.setDiffDensity);

  return (
    <Page title="General">
      <Group title="Appearance">
        <Row label="Theme">
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' }
            ]}
          />
        </Row>
      </Group>
      <Group title="Diffs">
        <Row label="Font size">
          <input
            type="range"
            min={DIFF_FONT_SIZE_MIN}
            max={DIFF_FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(parseInt(e.target.value, 10))}
            className="w-40 accent-accent"
          />
          <span className="w-9 text-right font-mono text-2xs tabular-nums text-fg-muted">{fontSize}px</span>
        </Row>
        <Row label="Line spacing">
          <Segmented
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'comfortable', label: 'Comfortable' }
            ]}
          />
        </Row>
        <div
          className="border-t border-border-muted bg-canvas px-4 py-2 font-mono"
          style={{ fontSize, lineHeight: density === 'comfortable' ? 1.9 : 1.45 }}
        >
          <div className="text-danger/90">- const total = items.length;</div>
          <div className="text-success/90">+ const total = items.filter(isVisible).length;</div>
        </div>
      </Group>
    </Page>
  );
}

// =====================================================================================
// AI review
// =====================================================================================

const DEFAULT_MODEL = '__default__';
const DEFAULT_EFFORT = '__default__';
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh'];

export function useAIAuth() {
  const cfgQ = useQuery({ queryKey: qk.aiConfig, queryFn: () => unwrap(api.ai.getConfig()) });
  const provider = cfgQ.data?.provider ?? 'codex';
  return useQuery({
    queryKey: qk.aiAuth(provider),
    queryFn: () => unwrap(api.ai.authStatus(provider)),
    staleTime: 30_000,
    enabled: !!cfgQ.data
  });
}

export function AISettings() {
  const qc = useQueryClient();
  const cfgQ = useQuery({ queryKey: qk.aiConfig, queryFn: () => unwrap(api.ai.getConfig()) });
  const cfg = cfgQ.data;
  const provider = cfg?.provider ?? 'codex';
  const authQ = useAIAuth();
  const claudeModelsQ = useQuery({
    queryKey: qk.claudeModels,
    queryFn: () => unwrap(api.ai.claudeModels()),
    staleTime: Infinity
  });
  const modelsQ = useQuery({
    queryKey: qk.codexModels,
    queryFn: () => unwrap(api.ai.codexModels()),
    enabled: provider === 'codex',
    staleTime: 5 * 60_000,
    retry: false
  });
  const [err, setErr] = useState<string | null>(null);

  async function save(patch: Partial<AIConfig>) {
    setErr(null);
    try {
      await unwrap(api.ai.setConfig(patch));
      await qc.invalidateQueries({ queryKey: qk.aiConfig });
      await qc.invalidateQueries({ queryKey: ['ai-auth'] });
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  const models = modelsQ.data ?? [];
  const defaultModel = models.find((m) => m.isDefault);
  const selectedModel = cfg?.codexModel ?? null;
  const modelInfo = selectedModel ? models.find((m) => m.id === selectedModel) : defaultModel;
  const efforts = modelInfo && modelInfo.reasoningEfforts.length > 0 ? modelInfo.reasoningEfforts : FALLBACK_EFFORTS;

  const auth = authQ.data;
  const status = authQ.isLoading ? (
    <span className="flex items-center gap-1.5">
      <Spinner size="xs" /> Checking…
    </span>
  ) : auth?.available ? (
    <span className="flex items-center gap-1.5">
      <StatusDot tone="ok" /> Ready{auth.detail ? ` · ${auth.detail}` : ''}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-danger">
      <StatusDot tone="error" />
      {auth?.detail ?? (authQ.error as ApiError | null)?.message ?? 'Unavailable'}
    </span>
  );

  return (
    <Page
      title="AI review"
      description="Both providers use their own CLI login; this app stores no AI credentials. You can switch provider and depth per review."
    >
      <Group title="Reviewer">
        <Row
          label="Provider"
          description={
            <span className="flex items-center gap-2">
              {status}
              <button
                className="text-fg-subtle hover:text-fg"
                onClick={() => void authQ.refetch()}
                title="Check again"
                disabled={authQ.isFetching}
              >
                <RefreshCw className={cn('h-3 w-3', authQ.isFetching && 'animate-spin')} />
              </button>
            </span>
          }
        >
          <Segmented
            value={provider}
            onChange={(v) => void save({ provider: v })}
            options={[
              { value: 'codex', label: 'Codex' },
              { value: 'claude', label: 'Claude' }
            ]}
          />
        </Row>
        {provider === 'codex' ? (
          <>
            <Row
              label="Model"
              description={
                modelsQ.isError
                  ? `Couldn't list models: ${(modelsQ.error as ApiError).message}`
                  : modelInfo?.description ?? 'Default comes from ~/.codex/config.toml.'
              }
            >
              <Select
                value={selectedModel ?? DEFAULT_MODEL}
                onValueChange={(v) => void save({ codexModel: v === DEFAULT_MODEL ? null : v, codexReasoningEffort: null })}
                disabled={modelsQ.isLoading}
              >
                <SelectTrigger className="h-7 w-56 text-xs">
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL}>Default{defaultModel ? ` (${defaultModel.id})` : ''}</SelectItem>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row label="Reasoning effort" description="By default: low for quick reviews, high for thorough ones.">
              <Select
                value={cfg?.codexReasoningEffort ?? DEFAULT_EFFORT}
                onValueChange={(v) => void save({ codexReasoningEffort: v === DEFAULT_EFFORT ? null : v })}
              >
                <SelectTrigger className="h-7 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_EFFORT}>From review depth</SelectItem>
                  {efforts.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          </>
        ) : (
          <Row label="Model" description="Used for thorough reviews, chat and fixes. Quick reviews use Claude Sonnet 5.">
            <Select value={cfg?.claudeModel ?? 'claude-opus-5'} onValueChange={(v) => void save({ claudeModel: v })}>
              <SelectTrigger className="h-7 w-56 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(claudeModelsQ.data ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}
      </Group>

      <Group title="Reviews">
        <Row
          label="Default depth"
          description="Thorough explores the checkout (callers, tests, configs); quick is faster and cheaper."
        >
          <Segmented
            value={cfg?.depth ?? 'thorough'}
            onChange={(v) => void save({ depth: v })}
            options={[
              { value: 'thorough', label: 'Thorough' },
              { value: 'quick', label: 'Quick' }
            ]}
          />
        </Row>
        <Row
          label="Review automatically"
          htmlFor="ai-auto"
          description="Start a review when you open a PR whose latest commit hasn't been reviewed."
        >
          <Switch id="ai-auto" checked={cfg?.autoReview ?? false} onChange={(v) => void save({ autoReview: v })} />
        </Row>
        <Row label="Comment language" description="For the verdict, notes and findings. Technical terms stay in English.">
          <Segmented
            value={cfg?.language ?? 'tr'}
            onChange={(v) => void save({ language: v })}
            options={[
              { value: 'tr', label: 'Türkçe' },
              { value: 'en', label: 'English' }
            ]}
          />
        </Row>
        <DirectiveRow value={cfg?.directive ?? null} onSave={(directive) => save({ directive })} />
      </Group>
      {err && <p className="text-2xs text-danger">{err}</p>}
    </Page>
  );
}

/**
 * The review directive (persona + checklist). The JSON output contract is
 * appended by the app, so edits here can't break parsing.
 */
function DirectiveRow({ value, onSave }: { value: string | null; onSave: (d: string | null) => Promise<void> }) {
  const defaultQ = useQuery({
    queryKey: ['ai', 'directive', 'default'] as const,
    queryFn: () => unwrap(api.ai.defaultDirective()),
    staleTime: Infinity
  });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value ?? defaultQ.data ?? '';
  const dirty = text != null && text !== (value ?? defaultQ.data ?? '');
  const customized = !!value;

  return (
    <div>
      <Row
        label="Review directive"
        description={`Persona, priorities and what not to comment on. ${customized ? 'Customized.' : 'Built-in default.'}`}
      >
        <button className="btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Edit'}
        </button>
      </Row>
      {open && (
        <div className="space-y-2 border-t border-border-muted px-4 py-3">
          <textarea
            value={shown}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={16}
            className="input h-auto w-full resize-y py-2 font-mono text-2xs leading-relaxed"
          />
          <div className="flex items-center gap-2">
            {dirty && <span className="text-2xs text-fg-subtle">Unsaved changes</span>}
            <button
              className="btn-ghost ml-auto"
              disabled={!customized && text == null}
              onClick={async () => {
                await onSave(null);
                setText(null);
              }}
            >
              Reset to default
            </button>
            <button
              className="btn-primary"
              disabled={!dirty}
              onClick={async () => {
                const next = (text ?? '').trim();
                await onSave(next && next !== defaultQ.data ? next : null);
                setText(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// Repositories
// =====================================================================================

export function ReposSettings() {
  const qc = useQueryClient();
  const reposQ = useQuery({ queryKey: qk.repos, queryFn: () => unwrap(api.repos.list()) });
  const { add, adding, error } = useAddRepo();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function remove(id: string) {
    if (confirm !== id) {
      setConfirm(id);
      setTimeout(() => setConfirm((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirm(null);
    setErr(null);
    try {
      await unwrap(api.repos.remove(id));
      const ui = useUI.getState();
      for (const t of ui.tabs.filter((t) => t.repoId === id)) ui.closeTab(t.repoId, t.prNumber);
      if (useUI.getState().selectedRepoId === id) useUI.setState({ selectedRepoId: null, selectedPRNumber: null });
      await qc.invalidateQueries({ queryKey: qk.repos });
      await qc.invalidateQueries({ queryKey: qk.openCounts });
    } catch (e) {
      setErr((e as ApiError).message);
    }
  }

  const repos = reposQ.data ?? [];
  return (
    <Page
      title="Repositories"
      description="Local clones whose open PRs appear in the inbox. Removing one here leaves the folder on disk untouched."
    >
      <Group
        title={`${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}`}
        action={
          <button className="btn h-7 text-xs" onClick={() => void add()} disabled={adding}>
            {adding ? <Spinner size="xs" /> : <Plus className="h-3.5 w-3.5" />}
            Add repository
          </button>
        }
        description={error || err ? <span className="text-danger">{error ?? err}</span> : undefined}
      >
        {reposQ.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : repos.length === 0 ? (
          <Row label="No repositories yet" description="Add a local clone of a GitHub repository." />
        ) : (
          repos.map((r) => (
            <Row
              key={r.id}
              label={
                <span>
                  {r.label}
                  {r.label !== r.name && <span className="text-fg-subtle"> · {r.name}</span>}
                </span>
              }
              description={
                <span className="flex min-w-0 gap-2">
                  <span>
                    {r.owner}/{r.name}
                  </span>
                  <span className="truncate font-mono" title={r.path}>
                    {r.path.replace(/^\/Users\/[^/]+/, '~')}
                  </span>
                </span>
              }
            >
              <button className="btn-icon h-7 w-7" title="Open folder" onClick={() => void api.repos.reveal(r.id)}>
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <button
                className="btn-icon h-7 w-7"
                title="Open on GitHub"
                onClick={() => api.shell.openExternal(`https://github.com/${r.owner}/${r.name}`)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                className={cn(confirm === r.id ? 'btn-danger h-7 text-xs' : 'btn-icon h-7 w-7')}
                title="Remove from PR Review"
                onClick={() => void remove(r.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {confirm === r.id && 'Remove?'}
              </button>
            </Row>
          ))
        )}
      </Group>
    </Page>
  );
}

// =====================================================================================
// Tools
// =====================================================================================

export function useSystemTools() {
  return useQuery({
    queryKey: qk.systemTools,
    queryFn: () => unwrap(api.system.tools()),
    staleTime: 30_000
  });
}

export function ToolsSettings() {
  const qc = useQueryClient();
  const toolsQ = useSystemTools();
  const tools = toolsQ.data ?? [];

  return (
    <Page
      title="Tools"
      description="Command-line tools this app runs. Missing ones only disable the features that need them."
      actions={
        <button
          className="btn-ghost h-7 text-xs"
          onClick={() => void qc.invalidateQueries({ queryKey: qk.systemTools })}
          disabled={toolsQ.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', toolsQ.isFetching && 'animate-spin')} />
          Check again
        </button>
      }
    >
      <Group>
        {toolsQ.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ) : toolsQ.isError ? (
          <div className="px-4 py-3 text-2xs text-danger">{(toolsQ.error as ApiError).message}</div>
        ) : (
          tools.map((t) => <ToolRow key={t.id} tool={t} />)
        )}
      </Group>
    </Page>
  );
}

function ToolRow({ tool }: { tool: SystemTool }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Row
        label={
          <span className="flex items-center gap-2">
            <StatusDot tone={tool.installed ? 'ok' : 'error'} />
            {tool.label}
            <code className="font-mono text-2xs text-fg-subtle">{tool.id}</code>
          </span>
        }
        description={
          <>
            {tool.description}
            {tool.installed && tool.path && (
              <span className="block truncate font-mono" title={tool.path}>
                {tool.path.replace(/^\/Users\/[^/]+/, '~')}
              </span>
            )}
          </>
        }
      >
        {tool.installed ? (
          <span className="font-mono text-2xs text-fg-muted">{tool.version ? `v${tool.version}` : 'installed'}</span>
        ) : (
          <button className="btn h-7 text-xs" onClick={() => api.shell.openExternal(tool.installUrl)}>
            <ExternalLink className="h-3.5 w-3.5" />
            Install
          </button>
        )}
      </Row>
      {!tool.installed && (
        <div className="flex items-center gap-2 px-4 pb-3">
          <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-border-muted bg-canvas-inset px-2 py-1 font-mono text-2xs text-fg">
            {tool.installCommand}
          </code>
          <button
            className="btn-ghost h-7 text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(tool.installCommand).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
