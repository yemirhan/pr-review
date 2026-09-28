/**
 * Syntax highlighting for whole files (used by the conflicts view), backed by
 * the highlighter @pierre/diffs already loads for the diff viewer. Results
 * are cached so re-renders don't re-tokenize.
 */

import { getSharedHighlighter, type SupportedLanguages } from '@pierre/diffs';

export type HighlightTheme = 'github-dark' | 'github-light';

const cache = new Map<string, string[]>();

function key(theme: HighlightTheme, lang: string, code: string): string {
  return `${theme}::${lang}::${code.length}::${code}`;
}

export async function highlightLines(
  lang: string,
  code: string,
  theme: HighlightTheme
): Promise<string[]> {
  const k = key(theme, lang, code);
  const hit = cache.get(k);
  if (hit) return hit;

  const lines = code.split('\n');
  let result: string[];
  try {
    const h = await getSharedHighlighter({
      themes: [theme],
      langs: [lang as SupportedLanguages]
    });
    const { tokens } = h.codeToTokens(code, { lang: lang as SupportedLanguages, theme });
    result = tokens
      .map((lineTokens) =>
        lineTokens
          .map((t) => {
            const color = t.color ? `color:${t.color}` : '';
            return `<span style="${color}">${escapeHtml(t.content)}</span>`;
          })
          .join('')
      )
      .concat(lines.length > tokens.length ? lines.slice(tokens.length).map(escapeHtml) : []);
  } catch {
    // Unknown language or theme — fall back to plain text.
    result = lines.map(escapeHtml);
  }
  cache.set(k, result);
  return result;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
