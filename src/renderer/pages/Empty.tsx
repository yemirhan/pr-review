import { useQueryClient } from '@tanstack/react-query';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { useUI } from '../store/ui';
import { useState } from 'react';

export function Empty() {
  const qc = useQueryClient();
  const selectRepo = useUI((s) => s.selectRepo);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function addRepo() {
    setAdding(true);
    setErr(null);
    try {
      const repo = await unwrap(api.repos.add());
      if (repo) {
        await qc.invalidateQueries({ queryKey: qk.repos });
        selectRepo(repo.id);
      }
    } catch (e) {
      const ae = e as ApiError;
      setErr(messageFor(ae));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center px-8 py-12 rounded-xl border border-border-muted bg-canvas-subtle/40">
        <div className="text-2xl font-semibold mb-2">Add a repository</div>
        <p className="text-fg-muted text-sm leading-relaxed mb-6">
          Pick any local git folder. The app reads its <code className="text-fg">origin</code>{' '}
          remote and lists open pull requests with the GitHub CLI.
        </p>
        <button className="btn-primary no-drag" onClick={addRepo} disabled={adding}>
          {adding ? 'Selecting…' : 'Select a folder'}
        </button>
        {err && (
          <div className="mt-4 text-xs text-danger bg-danger-subtle border border-danger-emphasis/40 rounded-md px-3 py-2">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}

function messageFor(e: ApiError): string {
  switch (e.code) {
    case 'NOT_A_GIT_REPO':
      return 'That folder is not a git repository.';
    case 'NOT_A_GITHUB_REMOTE':
      return 'No GitHub origin remote on this repo.';
    case 'GH_NOT_INSTALLED':
      return 'gh CLI not found. Install with `brew install gh`.';
    case 'GH_NOT_AUTHENTICATED':
      return 'gh CLI is not authenticated. Run `gh auth login` in your terminal.';
    default:
      return e.message;
  }
}
