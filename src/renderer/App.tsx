import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PRList } from './components/PRList';
import { PRDetail } from './components/PRDetail';
import { Empty } from './pages/Empty';
import { TitleBar } from './components/TitleBar';
import { SettingsView } from './components/settings/SettingsView';
import { CommandPalette } from './components/CommandPalette';
import { api, qk, unwrap } from './lib/api';
import { useUI } from './store/ui';
import { useTheme } from './lib/theme';
import { useAISessionEvents } from './lib/aiSessions';
import { useGlobalShortcuts } from './lib/shortcuts';
import { cn } from './lib/cn';

export function App() {
  useTheme();
  useAISessionEvents();
  useGlobalShortcuts();

  const reposQ = useQuery({
    queryKey: qk.repos,
    queryFn: () => unwrap(api.repos.list())
  });

  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);
  const selectRepo = useUI((s) => s.selectRepo);
  const settingsOpen = useUI((s) => s.settingsOpen);

  const repos = reposQ.data ?? [];
  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;

  // Land on a list, not a blank screen: pick the first repo when none is selected.
  useEffect(() => {
    if (!reposQ.data || reposQ.data.length === 0) return;
    if (!selectedRepoId || !reposQ.data.some((r) => r.id === selectedRepoId)) {
      selectRepo(reposQ.data[0].id);
    }
  }, [reposQ.data, selectedRepoId, selectRepo]);

  const noRepos = reposQ.isSuccess && repos.length === 0;
  const reviewing = selectedRepo != null && selectedPRNumber != null;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <TitleBar repos={repos} />
      {settingsOpen && <SettingsView />}
      {noRepos ? (
        !settingsOpen && <Empty />
      ) : (
        <>
          {/* Inbox and review stay mounted (hidden) under settings so filters/scroll survive a round trip. */}
          <div className={cn('flex min-h-0 flex-1', (reviewing || settingsOpen) && 'hidden')}>
            <Sidebar repos={repos} loading={reposQ.isLoading} />
            <PRList repo={selectedRepo} />
          </div>
          {reviewing && (
            <div className={cn('flex min-h-0 flex-1', settingsOpen && 'hidden')}>
              {/* Keyed per tab: each PR gets a fresh view; its sub-tab and scroll are restored. */}
              <PRDetail key={`${selectedRepo.id}:${selectedPRNumber}`} repo={selectedRepo} prNumber={selectedPRNumber} />
            </div>
          )}
        </>
      )}
      <CommandPalette repos={repos} />
    </div>
  );
}
