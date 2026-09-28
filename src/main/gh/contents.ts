import { ghJson } from './client';
import { cached } from './cache';

export interface FileAtRef {
  path: string;
  text: string;
  byteSize: number;
  truncated: boolean;
}

const MAX_FILE_BYTES = 60 * 1024;
const TTL_MS = 30 * 60_000; // keyed by commit SHA, so effectively immutable

interface BlobNode {
  text?: string | null;
  byteSize?: number;
  isBinary?: boolean;
}

/**
 * Fetch several files' contents at a commit in ONE GraphQL request. Used to
 * give the reviewer surrounding context for changed files without paying a
 * REST call per file.
 */
export async function getFilesAtRef(
  owner: string,
  name: string,
  ref: string,
  paths: string[]
): Promise<FileAtRef[]> {
  if (paths.length === 0) return [];
  const key = `repo:${owner}/${name}:blobs:${ref}:${paths.slice().sort().join(' ')}`;
  return cached(key, TTL_MS, async () => {
    const aliases = paths.map(
      (p, i) =>
        `b${i}: object(expression: ${JSON.stringify(`${ref}:${p}`)}) { ... on Blob { text byteSize isBinary } }`
    );
    const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${aliases.join(' ')} } }`;
    const res = await ghJson<{ data?: { repository?: Record<string, BlobNode | null> } }>(
      ['api', 'graphql', '-f', `query=${query}`],
      { timeoutMs: 60_000 }
    );
    const repo = res.data?.repository ?? {};
    const out: FileAtRef[] = [];
    paths.forEach((p, i) => {
      const node = repo[`b${i}`];
      if (!node || node.isBinary || typeof node.text !== 'string') return;
      const size = node.byteSize ?? Buffer.byteLength(node.text);
      const truncated = size > MAX_FILE_BYTES;
      out.push({
        path: p,
        text: truncated ? node.text.slice(0, MAX_FILE_BYTES) : node.text,
        byteSize: size,
        truncated
      });
    });
    return out;
  });
}
