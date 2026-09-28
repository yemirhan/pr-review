import { useAddRepo } from '../components/Sidebar';

export function Empty() {
  const { add, adding, error } = useAddRepo();

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="mb-1.5 text-xl font-semibold text-fg">PR Review</div>
        <p className="mb-6 text-sm text-fg-muted">
          Pick a local git folder — its GitHub <code className="text-fg">origin</code> pull
          requests show up here.
        </p>
        <button className="btn-primary no-drag" onClick={add} disabled={adding}>
          {adding ? 'Selecting…' : 'Add a repository'}
        </button>
        {error && <div className="mt-4 text-xs text-danger">{error}</div>}
      </div>
    </div>
  );
}
