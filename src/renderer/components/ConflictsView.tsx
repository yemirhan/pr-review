import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, qk, unwrap, ApiError } from '../lib/api';
import { highlightLines } from '../lib/highlight';
import type { ConflictFile, Editor, Repo } from '@shared/types';

export function ConflictsView({
  repo,
  prNumber,
  baseRefName
}: {
  repo: Repo;
  prNumber: number;
  baseRefName: string;
}) {
  const qc = useQueryClient();
  const conflictsQ = useQuery({
    queryKey: qk.prConflicts(repo.id, prNumber),
    queryFn: () => unwrap(api.prs.conflicts(repo.id, prNumber, baseRefName)),
    staleTime: 60_000
  });
  const editorsQ = useQuery({
    queryKey: qk.editors,
    queryFn: () => unwrap(api.editors.list()),
    staleTime: 5 * 60_000
  });

  if (conflictsQ.isLoading) {
    return (
      <div className="p-6 text-fg-muted">
        Fetching <code className="text-fg">{baseRefName}</code> + PR head, then running{' '}
        <code className="text-fg">git merge-tree</code>…
      </div>
    );
  }
  if (conflictsQ.error) {
    return (
      <div className="p-6">
        <ErrorPanel message={(conflictsQ.error as ApiError).message} />
      </div>
    );
  }

  const info = conflictsQ.data!;

  if (info.error) {
    return (
      <div className="p-6">
        <ErrorPanel message={info.error} />
        <button
          className="btn mt-3"
          onClick={() => qc.invalidateQueries({ queryKey: qk.prConflicts(repo.id, prNumber) })}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!info.conflicting || info.files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-muted">
        <div className="text-center">
          <div className="text-success text-base font-medium mb-1">No merge conflicts</div>
          <div className="text-2xs text-fg-subtle">
            This PR merges cleanly into <code className="text-fg">{baseRefName}</code>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="p-3 space-y-3">
        <div className="rounded-md border border-danger/40 bg-danger-subtle/50 px-3 py-2 text-sm">
          <span className="text-danger font-medium">
            {info.files.length} conflicting {info.files.length === 1 ? 'file' : 'files'}
          </span>{' '}
          <span className="text-fg-muted">
            when merging into <code className="text-fg">{baseRefName}</code>.
          </span>
        </div>
        {info.files.map((f) => (
          <ConflictFilePanel
            key={f.path}
            repo={repo}
            file={f}
            editors={editorsQ.data ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function ConflictFilePanel({
  repo,
  file,
  editors
}: {
  repo: Repo;
  file: ConflictFile;
  editors: Editor[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  const lang = useMemo(() => detectLang(file.path), [file.path]);
  const [tokens, setTokens] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTokens(null);
    if (lang === 'text' || !file.content) return;
    highlightLines(lang, file.content)
      .then((t) => {
        if (!cancelled) setTokens(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lang, file.content]);

  const rawLines = useMemo(() => file.content.split('\n'), [file.content]);

  async function openIn(id: string) {
    try {
      await unwrap(api.editors.open(id, repo.id, file.path));
    } catch {
      /* surfaced elsewhere */
    }
  }

  return (
    <section className="rounded-md border border-border bg-canvas-subtle/40 overflow-hidden">
      <header
        className="flex items-center justify-between px-3 h-9 border-b border-border-muted bg-canvas-inset/50"
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <span className="text-fg-subtle text-xs">{collapsed ? '▸' : '▾'}</span>
          <code className="text-sm text-fg truncate">{file.path}</code>
          {file.truncated && <span className="chip border-attention/40 text-attention">truncated</span>}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {editors.map((e) => (
            <button
              key={e.id}
              className="btn-ghost"
              onClick={() => openIn(e.id)}
              title={`Open ${file.path} in ${e.label}`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </header>
      {!collapsed && (
        <div className="font-mono text-xs leading-5 bg-canvas">
          {rawLines.map((line, i) => (
            <ConflictLine
              key={i}
              line={line}
              tokenHtml={tokens?.[i]}
              lineNumber={i + 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ConflictLine({
  line,
  tokenHtml,
  lineNumber
}: {
  line: string;
  tokenHtml: string | undefined;
  lineNumber: number;
}) {
  const variant = conflictMarkerVariant(line);
  const bg =
    variant === 'ours'
      ? 'bg-diff-delBg'
      : variant === 'theirs'
        ? 'bg-diff-addBg'
        : variant === 'marker'
          ? 'bg-attention-subtle/60'
          : '';
  return (
    <div className={`flex items-stretch ${bg}`}>
      <span className="w-12 shrink-0 text-right pr-2 text-fg-subtle bg-canvas-inset/40 border-r border-border-muted">
        {lineNumber}
      </span>
      <code
        className="flex-1 whitespace-pre pl-2 pr-3 text-fg"
        dangerouslySetInnerHTML={tokenHtml ? { __html: tokenHtml } : undefined}
      >
        {tokenHtml ? undefined : line || ' '}
      </code>
    </div>
  );
}

function conflictMarkerVariant(line: string): 'marker' | 'ours' | 'theirs' | null {
  if (/^<{7}( |\t|$)/.test(line)) return 'marker';
  if (/^={7}$/.test(line)) return 'marker';
  if (/^>{7}( |\t|$)/.test(line)) return 'marker';
  if (/^\|{7}( |\t|$)/.test(line)) return 'marker'; // diff3 base section header
  return null;
}

function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    swift: 'swift',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    css: 'css',
    scss: 'scss',
    html: 'html'
  };
  return map[ext] ?? 'text';
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="text-danger bg-danger-subtle border border-danger-emphasis/40 rounded-md px-4 py-3 max-w-2xl whitespace-pre-wrap">
      {message}
    </div>
  );
}
