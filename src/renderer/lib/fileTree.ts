import type { FileDiff } from '@shared/types';

export interface TreeFileNode {
  kind: 'file';
  /** Full path from repo root, e.g. "src/foo/bar.ts". */
  path: string;
  /** Just the last segment. */
  name: string;
  file: FileDiff;
}

export interface TreeDirNode {
  kind: 'dir';
  /** Full path of the directory ("" for the synthetic root). */
  path: string;
  name: string;
  children: TreeNode[];
}

export type TreeNode = TreeFileNode | TreeDirNode;

function sortChildren(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Collapse single-child directory chains. `src/components/Foo/index.ts` where
 * each intermediate dir has just one child becomes `src/components/Foo →
 * index.ts`. Mirrors GitHub's compact tree behaviour. Never collapses the
 * synthetic root.
 */
function collapseChains(node: TreeDirNode, isRoot: boolean): TreeDirNode {
  const merged = node.children.map((c) =>
    c.kind === 'dir' ? collapseChains(c, false) : c
  );
  if (!isRoot && merged.length === 1 && merged[0].kind === 'dir') {
    const only = merged[0];
    return {
      kind: 'dir',
      path: only.path,
      name: `${node.name}/${only.name}`,
      children: only.children
    };
  }
  return { ...node, children: merged };
}

/**
 * Build a directory tree from a flat list of FileDiff paths.
 * Single-child directory chains are collapsed for compactness.
 */
export function buildFileTree(files: FileDiff[]): TreeDirNode {
  const root: TreeDirNode = { kind: 'dir', path: '', name: '', children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let cursor: TreeDirNode = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const dirPath = parts.slice(0, i + 1).join('/');
      let next = cursor.children.find(
        (c): c is TreeDirNode => c.kind === 'dir' && c.name === seg
      );
      if (!next) {
        next = { kind: 'dir', path: dirPath, name: seg, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push({
      kind: 'file',
      path: file.path,
      name: parts[parts.length - 1],
      file
    });
  }

  function deepSort(node: TreeDirNode): void {
    sortChildren(node.children);
    for (const c of node.children) {
      if (c.kind === 'dir') deepSort(c);
    }
  }
  deepSort(root);

  return collapseChains(root, true);
}
