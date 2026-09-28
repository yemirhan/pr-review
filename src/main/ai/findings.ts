import { createHash } from 'node:crypto';
import type { AIFindingSeverity, AIReviewFinding, FileDiff } from '@shared/types';

/**
 * Output contract for the deep review, shared by both providers. Codex
 * enforces it via `outputSchema`; Claude is asked to emit exactly this JSON
 * and we parse leniently.
 */
export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'findings', 'notes'],
  properties: {
    verdict: {
      type: 'string',
      description: 'Overall verdict, 1-3 sentences, verdict first.'
    },
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'line', 'startLine', 'side', 'severity', 'title', 'comment', 'suggestion'],
        properties: {
          path: { type: 'string', description: 'File path exactly as shown in the diff.' },
          line: {
            type: 'integer',
            description:
              'Line number the comment anchors to. Use the NEW column for side RIGHT, the OLD column for side LEFT. Must be a line that appears in the diff.'
          },
          startLine: {
            type: ['integer', 'null'],
            description: 'First line of a multi-line range (same side), or null for a single line.'
          },
          side: { type: 'string', enum: ['RIGHT', 'LEFT'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string', description: 'Headline, max ~80 chars.' },
          comment: {
            type: 'string',
            description: 'The inline comment text: problem, impact, fix. 1-4 sentences. Markdown allowed.'
          },
          suggestion: {
            type: ['string', 'null'],
            description:
              'Exact replacement code for lines startLine..line (or just line) when the fix is small and precise. Otherwise null.'
          }
        }
      }
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'PR-level remarks that do not map to a single line: missing requirements, scope creep, material issues beyond the 8 inline findings.'
    }
  }
} as const;

export const OUTPUT_CONTRACT = [
  '## Output contract (mandatory)',
  '',
  'Respond with a single JSON object and nothing else: no prose before or after, no markdown fences. Shape:',
  '',
  '{',
  '  "verdict": "1-3 sentences, verdict first",',
  '  "findings": [',
  '    {',
  '      "path": "src/foo.tsx",',
  '      "line": 42,',
  '      "startLine": null,',
  '      "side": "RIGHT",',
  '      "severity": "high",',
  '      "title": "short headline",',
  '      "comment": "problem, impact, fix; 1-4 sentences",',
  '      "suggestion": null',
  '    }',
  '  ],',
  '  "notes": ["PR-level remark that has no single line"]',
  '}',
  '',
  'Rules for `line`/`side`: the diff below prints two number columns per line, `old` and `new`. Use `side: "RIGHT"` with the **new** column for added or unchanged lines (the normal case). Use `side: "LEFT"` with the **old** column only for a removed line. Never invent line numbers: every finding must point at a line that is printed in the diff. For a multi-line range set `startLine` (same side). A `suggestion` must be the exact replacement for `startLine..line` and nothing more.',
  '',
  '`findings` may be empty. `severity` is for prioritization only; do not write labels like "[HIGH]" into `comment`.'
].join('\n');

interface RawFinding {
  path?: unknown;
  line?: unknown;
  startLine?: unknown;
  start_line?: unknown;
  side?: unknown;
  severity?: unknown;
  title?: unknown;
  comment?: unknown;
  body?: unknown;
  suggestion?: unknown;
}

interface RawOutput {
  verdict?: unknown;
  summary?: unknown;
  findings?: unknown;
  notes?: unknown;
}

const SEVERITIES: AIFindingSeverity[] = ['critical', 'high', 'medium', 'low'];
const SEVERITY_ORDER: Record<AIFindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Pull the first JSON object out of a model reply that may have fences or prose around it. */
export function extractJson(text: string): RawOutput | null {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.unshift(fence[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as RawOutput;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Pull complete finding objects and the verdict out of a JSON reply that is
 * still streaming in. Objects inside `"findings": [` are emitted as soon as
 * their closing brace arrives, so the UI can show them before the model is
 * done writing.
 */
export function extractPartial(text: string): { verdict: string | null; findings: RawFinding[] } {
  let verdict: string | null = null;
  const vm = text.match(/"verdict"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (vm) {
    try {
      verdict = JSON.parse(`"${vm[1]}"`) as string;
    } catch {
      verdict = null;
    }
  }
  const findings: RawFinding[] = [];
  const key = text.search(/"findings"\s*:\s*\[/);
  if (key < 0) return { verdict, findings };
  let i = text.indexOf('[', key) + 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objStart = -1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          findings.push(JSON.parse(text.slice(objStart, i + 1)) as RawFinding);
        } catch {
          /* malformed; skip */
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  return { verdict, findings };
}

interface LineIndex {
  right: Map<number, string>;
  left: Map<number, string>;
}

function indexFile(file: FileDiff): LineIndex {
  const right = new Map<number, string>();
  const left = new Map<number, string>();
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.newNo != null) right.set(l.newNo, l.content);
      if (l.oldNo != null && l.type !== 'add') left.set(l.oldNo, l.content);
    }
  }
  return { right, left };
}

function asInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return parseInt(v, 10);
  return undefined;
}

function normalizePath(p: string, known: Set<string>): string {
  const clean = p.trim().replace(/^\.?\//, '').replace(/^[ab]\//, '');
  if (known.has(clean)) return clean;
  // Model sometimes shortens paths; accept a unique suffix match.
  const matches = [...known].filter((k) => k.endsWith('/' + clean) || k === clean);
  return matches.length === 1 ? matches[0] : clean;
}

function stableId(parts: string[]): string {
  return 'f' + createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}

/**
 * Turns raw finding objects into validated findings for one diff. A finding
 * is `anchored` only when its path/line/side resolve to a line printed in the
 * diff (the same rule GitHub applies when the inline comment is posted).
 * Ids hash the anchored line's text rather than its number, so they survive
 * re-runs and small upstream shifts.
 */
export class FindingNormalizer {
  private known: Set<string>;
  private indexes = new Map<string, LineIndex>();
  private seen = new Set<string>();

  constructor(private files: FileDiff[]) {
    this.known = new Set(files.map((f) => f.path));
  }

  private indexFor(path: string): LineIndex {
    let idx = this.indexes.get(path);
    if (!idx) {
      const f = this.files.find((x) => x.path === path);
      idx = f ? indexFile(f) : { right: new Map(), left: new Map() };
      this.indexes.set(path, idx);
    }
    return idx;
  }

  /** Returns null for invalid or duplicate findings. */
  normalize(f: RawFinding): AIReviewFinding | null {
    if (!f || typeof f !== 'object') return null;
    const pathRaw = typeof f.path === 'string' ? f.path : '';
    const body = String(f.comment ?? f.body ?? '').trim();
    if (!pathRaw || !body) return null;
    const path = normalizePath(pathRaw, this.known);
    const lineRaw = asInt(f.line);
    const startLineRaw = asInt(f.startLine ?? f.start_line);
    const side: 'LEFT' | 'RIGHT' = f.side === 'LEFT' ? 'LEFT' : 'RIGHT';
    const sevRaw = String(f.severity ?? 'medium').toLowerCase() as AIFindingSeverity;
    const severity = SEVERITIES.includes(sevRaw) ? sevRaw : 'medium';
    const title = String(f.title ?? '').trim() || body.split(/[.!?\n]/)[0].slice(0, 80);
    const suggestionRaw =
      typeof f.suggestion === 'string' && f.suggestion.trim() ? f.suggestion.replace(/\s+$/, '') : null;

    const idx = this.indexFor(path);
    const lines = side === 'LEFT' ? idx.left : idx.right;
    const anchored = this.known.has(path) && lineRaw != null && lines.has(lineRaw);
    let startLine: number | undefined;
    if (anchored && startLineRaw != null && startLineRaw < (lineRaw as number) && lines.has(startLineRaw)) {
      startLine = startLineRaw;
    }
    // GitHub only renders suggestion blocks on new-side line comments.
    const suggestion = anchored && side === 'RIGHT' ? suggestionRaw : null;

    const lineText = anchored ? (lines.get(lineRaw as number) ?? '').trim() : '';
    const id = stableId([path, side, lineText, title.toLowerCase()]);
    if (this.seen.has(id)) return null;
    this.seen.add(id);

    return {
      id,
      path,
      line: anchored ? (lineRaw as number) : null,
      startLine,
      side,
      severity,
      title,
      body: suggestionRaw && !suggestion ? `${body}\n\n\`\`\`\n${suggestionRaw}\n\`\`\`` : body,
      suggestion,
      anchored
    };
  }
}

export function sortFindings(list: AIReviewFinding[]): AIReviewFinding[] {
  return [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface ParsedReview {
  verdict: string;
  findings: AIReviewFinding[];
  notes: string[];
  parsed: boolean;
}

/** Parse a finished review reply. */
export function parseReviewOutput(text: string, files: FileDiff[]): ParsedReview {
  const raw = extractJson(text);
  if (!raw) return { verdict: text.trim(), findings: [], notes: [], parsed: false };
  const norm = new FindingNormalizer(files);
  const list = Array.isArray(raw.findings) ? (raw.findings as RawFinding[]) : [];
  const findings: AIReviewFinding[] = [];
  for (const f of list) {
    const n = norm.normalize(f);
    if (n) findings.push(n);
  }
  const notes = Array.isArray(raw.notes)
    ? (raw.notes as unknown[]).map((n) => String(n ?? '').trim()).filter(Boolean)
    : [];
  const verdict = String(raw.verdict ?? raw.summary ?? '').trim();
  return { verdict, findings: sortFindings(findings), notes, parsed: true };
}
