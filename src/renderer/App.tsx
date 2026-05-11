import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PRList } from './components/PRList';
import { PRDetail } from './components/PRDetail';
import { Empty } from './pages/Empty';
import { TitleBar } from './components/TitleBar';
import { api, qk, unwrap } from './lib/api';
import { useUI } from './store/ui';

export function App() {
  const reposQ = useQuery({
    queryKey: qk.repos,
    queryFn: () => unwrap(api.repos.list())
  });

  const selectedRepoId = useUI((s) => s.selectedRepoId);
  const selectedPRNumber = useUI((s) => s.selectedPRNumber);

  const repos = reposQ.data ?? [];
  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? null;

  return (
    <div className="h-full flex flex-col bg-canvas">
      <TitleBar />
      <div className="flex-1 flex min-h-0">
        <Sidebar repos={repos} loading={reposQ.isLoading} />
        {repos.length === 0 ? (
          <Empty />
        ) : (
          <>
            <PRList repo={selectedRepo} />
            <PRDetail repo={selectedRepo} prNumber={selectedPRNumber} />
          </>
        )}
      </div>
    </div>
  );
}
