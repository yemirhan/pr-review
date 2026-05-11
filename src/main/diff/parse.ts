import parseDiff from 'parse-diff';
import type { DiffHunk, FileDiff } from '@shared/types';
import { detectLanguage } from './lang';

type ParsedFile = ReturnType<typeof parseDiff>[number];
type ParsedChange = ParsedFile['chunks'][number]['changes'][number];

function chunkToHunk(chunk: ParsedFile['chunks'][number]): {
  hunk: DiffHunk;
  adds: number;
  dels: number;
} {
  let adds = 0;
  let dels = 0;
  const lines = chunk.changes.map((c: ParsedChange) => {
    const type: 'context' | 'add' | 'del' =
      c.type === 'add' ? 'add' : c.type === 'del' ? 'del' : 'context';
    const oldNo =
      c.type === 'add'
        ? null
        : c.type === 'del'
          ? c.ln
          : (c as { ln1: number }).ln1;
    const newNo =
      c.type === 'del'
        ? null
        : c.type === 'add'
          ? c.ln
          : (c as { ln2: number }).ln2;
    if (type === 'add') adds++;
    else if (type === 'del') dels++;
    const content = c.content.replace(/^[+\- ]/, '');
    return { type, oldNo, newNo, content };
  });
  return {
    hunk: {
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      header: chunk.content,
      lines
    },
    adds,
    dels
  };
}

function fileToFileDiff(file: ParsedFile): FileDiff {
  const to = file.to && file.to !== '/dev/null' ? file.to : undefined;
  const from = file.from && file.from !== '/dev/null' ? file.from : undefined;
  const path = to ?? from ?? 'unknown';
  const oldPath = from && from !== path ? from : undefined;

  let additions = 0;
  let deletions = 0;
  const hunks: DiffHunk[] = file.chunks.map((chunk) => {
    const { hunk, adds, dels } = chunkToHunk(chunk);
    additions += adds;
    deletions += dels;
    return hunk;
  });

  const status: FileDiff['status'] = file.new
    ? 'added'
    : file.deleted
      ? 'removed'
      : oldPath
        ? 'renamed'
        : 'modified';

  return {
    path,
    oldPath,
    status,
    additions,
    deletions,
    language: detectLanguage(path),
    binary: false,
    hunks
  };
}

/**
 * Map a single file's patch from the GitHub PR files API into our FileDiff
 * shape. The API returns each file's patch without `diff --git` headers, so
 * we synthesize them before parsing.
 */
export function mapPatchToFileDiff(raw: {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}): FileDiff {
  const binary = !raw.patch;
  const baseStatus = (raw.status as FileDiff['status']) ?? 'modified';

  if (binary) {
    return {
      path: raw.filename,
      oldPath: raw.previous_filename,
      status: baseStatus,
      additions: raw.additions,
      deletions: raw.deletions,
      language: detectLanguage(raw.filename),
      binary: true,
      hunks: [],
      patch: undefined
    };
  }

  const wrapped =
    `diff --git a/${raw.previous_filename ?? raw.filename} b/${raw.filename}\n` +
    `--- a/${raw.previous_filename ?? raw.filename}\n` +
    `+++ b/${raw.filename}\n` +
    raw.patch;
  const parsed = parseDiff(wrapped);
  const file = parsed[0];

  if (!file) {
    return {
      path: raw.filename,
      oldPath: raw.previous_filename,
      status: baseStatus,
      additions: raw.additions,
      deletions: raw.deletions,
      language: detectLanguage(raw.filename),
      binary: false,
      hunks: [],
      patch: raw.patch
    };
  }

  const fd = fileToFileDiff(file);
  return {
    ...fd,
    path: raw.filename,
    oldPath: raw.previous_filename,
    status: baseStatus,
    additions: raw.additions,
    deletions: raw.deletions,
    language: detectLanguage(raw.filename),
    patch: raw.patch
  };
}

/**
 * Parse a full unified diff (e.g. the output of `git diff HEAD`) into
 * FileDiff[].
 */
export function parseUnifiedDiff(rawDiff: string): FileDiff[] {
  if (!rawDiff.trim()) return [];
  const files = parseDiff(rawDiff);
  return files.map(fileToFileDiff);
}
