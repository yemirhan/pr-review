import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { SidebarRail } from './components/SidebarRail';
import { PRList } from './components/PRList';
import { PRDetail } from './components/PRDetail';
import { Empty } from './pages/Empty';
import { TitleBar } from './components/TitleBar';
import { SettingsModal } from './components/SettingsModal';
import { api, qk, unwrap } from './lib/api';
import { useUI } from './store/ui';
import { useTheme } from './lib/theme';

export function App() {
  useTheme();

  const reposQ = useQuery({
    queryKey: qk.repos,
    queryFn: () => unwrap(api.repos.list())
  });

  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);

  const repos = reposQ.data ?? [];
  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;

  return (
    <div className="h-full flex flex-col bg-canvas">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <div className="transition-[width] duration-200 ease-smooth motion-reduce:transition-none flex">
          {sidebarCollapsed && repos.length > 0 ? (
            <SidebarRail repos={repos} />
          ) : (
            <Sidebar repos={repos} loading={reposQ.isLoading} />
          )}
        </div>
        {repos.length === 0 ? (
          <Empty />
        ) : (
          <>
            <PRList repo={selectedRepo} />
            <PRDetail repo={selectedRepo} prNumber={selectedPRNumber} />
          </>
        )}
      </div>
      <SettingsModal />
    </div>
  );
}
