import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUI, type SettingsTab } from '../../store/ui';
import { AISettings, GeneralSettings, ReposSettings, ToolsSettings, useAIAuth, useSystemTools } from './AppSettings';
import { JenkinsSettings, VercelSettings, useJenkinsStatus, useVercelStatus } from './BuildSettings';
import { ClickUpSettings, useClickUpStatus } from './ClickUpSettings';
import { WorktreesSettings } from './WorktreesSettings';
import { StatusDot, type StatusTone } from './primitives';

const NAV: { group: string; items: { key: SettingsTab; label: string }[] }[] = [
  {
    group: 'App',
    items: [
      { key: 'general', label: 'General' },
      { key: 'ai', label: 'AI review' },
      { key: 'repos', label: 'Repositories' },
      { key: 'worktrees', label: 'Worktrees' },
      { key: 'tools', label: 'Tools' }
    ]
  },
  {
    group: 'Integrations',
    items: [
      { key: 'clickup', label: 'ClickUp' },
      { key: 'jenkins', label: 'Jenkins' },
      { key: 'vercel', label: 'Vercel' }
    ]
  }
];

type ConnState = { state: 'unconfigured' } | { state: 'ok' } | { state: 'error' } | undefined;
const toneOf = (s: ConnState): StatusTone | null =>
  !s || s.state === 'unconfigured' ? null : s.state === 'ok' ? 'ok' : 'error';

/**
 * Full-window settings, shown in place of the inbox/review. Esc or a click on
 * any tab goes back. The nav shows at a glance what's connected or broken.
 */
export function SettingsView() {
  const tab = useUI((s) => s.settingsTab);
  const setTab = useUI((s) => s.setSettingsTab);
  const close = () => useUI.getState().setSettingsOpen(false);

  const jenkins = useJenkinsStatus().data;
  const vercel = useVercelStatus().data;
  const clickup = useClickUpStatus().data;
  const ai = useAIAuth().data;
  const tools = useSystemTools().data;

  const dots: Partial<Record<SettingsTab, StatusTone | null>> = {
    jenkins: toneOf(jenkins),
    vercel: toneOf(vercel),
    clickup: toneOf(clickup),
    ai: ai && !ai.available ? 'error' : null,
    tools: tools?.some((t) => !t.installed) ? 'error' : null
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border-muted px-2 py-3">
        <button
          onClick={close}
          className="mb-3 flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-subtle hover:bg-canvas-subtle hover:text-fg"
          title="Back (Esc)"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
        {NAV.map((g) => (
          <nav key={g.group} className="mb-4">
            <div className="px-2 pb-1 text-2xs font-medium text-fg-subtle">{g.group}</div>
            {g.items.map((it) => {
              const dot = dots[it.key];
              return (
                <button
                  key={it.key}
                  onClick={() => setTab(it.key)}
                  aria-current={tab === it.key ? 'page' : undefined}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
                    tab === it.key ? 'bg-canvas-subtle text-fg' : 'text-fg-muted hover:bg-canvas-subtle/60 hover:text-fg'
                  )}
                >
                  <span className="flex-1">{it.label}</span>
                  {dot && <StatusDot tone={dot} />}
                </button>
              );
            })}
          </nav>
        ))}
      </aside>
      <main key={tab} className="min-w-0 flex-1 overflow-y-auto">
        {tab === 'general' && <GeneralSettings />}
        {tab === 'ai' && <AISettings />}
        {tab === 'repos' && <ReposSettings />}
        {tab === 'worktrees' && <WorktreesSettings />}
        {tab === 'tools' && <ToolsSettings />}
        {tab === 'clickup' && <ClickUpSettings />}
        {tab === 'jenkins' && <JenkinsSettings />}
        {tab === 'vercel' && <VercelSettings />}
      </main>
    </div>
  );
}
