import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect } from 'react';
import { api, qk, unwrap } from '../lib/api';

export function EditorMenu({ repoId }: { repoId: string }) {
  const editorsQ = useQuery({
    queryKey: qk.editors,
    queryFn: () => unwrap(api.editors.list()),
    staleTime: 5 * 60_000
  });
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const editors = editorsQ.data ?? [];

  async function openIn(id: string) {
    setErr(null);
    setOpening(id);
    try {
      await unwrap(api.editors.open(id, repoId));
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        className="btn disabled:opacity-50"
        onClick={() => setOpen((o) => !o)}
        disabled={editorsQ.isLoading || editors.length === 0}
        title={editors.length === 0 ? 'No supported editor found on this Mac' : 'Open in editor'}
      >
        Open in editor ▾
      </button>
      {open && editors.length > 0 && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-md border border-border bg-canvas-overlay shadow-xl py-1 animate-fade-in">
          {editors.map((e) => (
            <button
              key={e.id}
              onClick={() => openIn(e.id)}
              disabled={opening === e.id}
              className="w-full px-3 h-7 text-sm text-left text-fg hover:bg-canvas-subtle flex items-center justify-between"
            >
              <span>{e.label}</span>
              <span className="text-2xs text-fg-subtle">
                {opening === e.id ? '…' : e.cliPath ? 'CLI' : 'App'}
              </span>
            </button>
          ))}
          {err && <div className="px-3 py-2 text-2xs text-danger border-t border-border-muted">{err}</div>}
        </div>
      )}
    </div>
  );
}
