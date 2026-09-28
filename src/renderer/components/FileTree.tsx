import { useEffect, useMemo, useState } from 'react';
import type { FileDiff } from '@shared/types';
import { buildFileTree, type TreeDirNode, type TreeNode } from '../lib/fileTree';
import { useUI, viewedKey } from '../store/ui';

interface Props {
  files: FileDiff[];
  repoId: string;
  prNumber: number;
  headOid: string;
  /** File paths that contain at least one search match (highlights them). */
  filesWithMatches?: Set<string>;
  /** The file currently in focus (e.g. the active search match's file). */
  activeFilePath?: string;
  /** The file currently scrolled into the diff viewport. Softer highlight. */
  viewingFilePath?: string;
  /** Click a file row → scroll to that file in the diff. */
  onSelectFile: (path: string) => void;
  /** AI findings per file path. */
  findingCounts?: Map<string, number>;
}

export function FileTree({
  files,
  repoId,
  prNumber,
  headOid,
  filesWithMatches,
  activeFilePath,
  viewingFilePath,
  onSelectFile,
  findingCounts
}: Props) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  // Track collapsed directory paths. By default everything is expanded.
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  // Reset folder state when the PR changes.
  useEffect(() => {
    setCollapsedDirs(new Set());
  }, [prNumber, repoId]);

  function toggleDir(path: string) {
    setCollapsedDirs((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (files.length === 0) {
    return (
      <div className="p-3 text-2xs text-fg-subtle italic">No files.</div>
    );
  }

  return (
    <div className="text-xs py-1.5 select-none">
      {tree.children.map((node) => (
        <TreeNodeRow
          key={node.path || node.name}
          node={node}
          depth={0}
          collapsedDirs={collapsedDirs}
          toggleDir={toggleDir}
          repoId={repoId}
          prNumber={prNumber}
          headOid={headOid}
          filesWithMatches={filesWithMatches}
          activeFilePath={activeFilePath}
          viewingFilePath={viewingFilePath}
          onSelectFile={onSelectFile}
          findingCounts={findingCounts}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  collapsedDirs: Set<string>;
  toggleDir: (path: string) => void;
  repoId: string;
  prNumber: number;
  headOid: string;
  filesWithMatches?: Set<string>;
  activeFilePath?: string;
  viewingFilePath?: string;
  onSelectFile: (path: string) => void;
  findingCounts?: Map<string, number>;
}

function TreeNodeRow(props: RowProps) {
  const { node } = props;
  if (node.kind === 'dir') return <DirRow {...props} node={node} />;
  return <FileRow {...props} node={node} />;
}

function DirRow({ node, depth, collapsedDirs, toggleDir, ...rest }: RowProps & { node: TreeDirNode }) {
  const collapsed = collapsedDirs.has(node.path);
  return (
    <>
      <button
        onClick={() => toggleDir(node.path)}
        className="w-full flex items-center gap-1 px-2 h-6 hover:bg-canvas-subtle text-fg-muted text-left"
        style={{ paddingLeft: 8 + depth * 12 }}
        title={node.path}
      >
        <span className="w-3 text-fg-subtle text-2xs">{collapsed ? '▸' : '▾'}</span>
        <span className="truncate text-fg-muted">{node.name}</span>
      </button>
      {!collapsed &&
        node.children.map((c) => (
          <TreeNodeRow
            key={c.path || c.name}
            {...rest}
            node={c}
            depth={depth + 1}
            collapsedDirs={collapsedDirs}
            toggleDir={toggleDir}
          />
        ))}
    </>
  );
}

function FileRow({
  node,
  depth,
  repoId,
  prNumber,
  headOid,
  filesWithMatches,
  activeFilePath,
  viewingFilePath,
  onSelectFile,
  findingCounts
}: RowProps & { node: Extract<TreeNode, { kind: 'file' }> }) {
  const findings = findingCounts?.get(node.file.path) ?? 0;
  const file = node.file;
  const vKey = viewedKey(repoId, prNumber, headOid, file.path);
  const viewed = useUI((s) => !!s.viewed[vKey]);
  const isActive = activeFilePath === file.path;
  const isViewing = !isActive && viewingFilePath === file.path;
  const hasMatch = filesWithMatches?.has(file.path);

  const rowStyle = isActive
    ? 'bg-accent-subtle border-l-2 border-accent'
    : isViewing
      ? 'bg-canvas-subtle border-l-2 border-fg-subtle/60'
      : 'border-l-2 border-transparent hover:bg-canvas-subtle';

  return (
    <button
      onClick={() => onSelectFile(file.path)}
      className={`w-full flex items-center gap-2 px-2 h-6 text-left transition-colors ${rowStyle}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      title={file.path}
    >
      <span className={`w-3 ${statusColor(file.status)} text-2xs shrink-0`}>
        {statusGlyph(file.status)}
      </span>
      <span
        className={`flex-1 truncate ${
          viewed ? 'text-fg-subtle line-through' : 'text-fg'
        }`}
      >
        {node.name}
      </span>
      {hasMatch && !isActive && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-attention shrink-0"
          aria-label="contains search match"
        />
      )}
      {findings > 0 && (
        <span className="text-2xs text-accent tabular-nums shrink-0" title={`${findings} AI finding(s)`}>
          ✦{findings}
        </span>
      )}
      <span className="text-2xs text-fg-subtle tabular-nums shrink-0">
        +{file.additions} −{file.deletions}
      </span>
    </button>
  );
}

function statusGlyph(status: FileDiff['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'removed':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    default:
      return 'M';
  }
}

function statusColor(status: FileDiff['status']): string {
  switch (status) {
    case 'added':
      return 'text-success';
    case 'removed':
      return 'text-danger';
    case 'renamed':
      return 'text-attention';
    default:
      return 'text-fg-subtle';
  }
}
