/// <reference lib="webworker" />
import { createHighlighter, type Highlighter } from 'shiki';

type Req = { id: number; lang: string; code: string };
type Res =
  | { id: number; ok: true; tokens: string[] }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let highlighterP: Promise<Highlighter> | null = null;

const PRELOAD_LANGS = ['typescript', 'tsx', 'javascript', 'jsx', 'json', 'markdown', 'shell'];

function getHighlighter() {
  if (!highlighterP) {
    highlighterP = createHighlighter({
      themes: ['github-dark'],
      langs: PRELOAD_LANGS
    });
  }
  return highlighterP;
}

const loadedLangs = new Set<string>(PRELOAD_LANGS);

async function ensureLang(h: Highlighter, lang: string) {
  if (loadedLangs.has(lang) || lang === 'text') return;
  try {
    await h.loadLanguage(lang as never);
    loadedLangs.add(lang);
  } catch {
    // Unknown language — fall through to plain text.
  }
}

/**
 * Tokenize each line into a span-string array preserving Shiki colors.
 * One result entry per source line.
 */
function tokenize(h: Highlighter, lang: string, code: string): string[] {
  try {
    const lines = code.split('\n');
    const { tokens } = h.codeToTokens(code, { lang: lang as never, theme: 'github-dark' });
    return tokens.map((lineTokens) => {
      return lineTokens
        .map((t) => {
          const color = t.color ? `color:${t.color}` : '';
          const safe = escapeHtml(t.content);
          return `<span style="${color}">${safe}</span>`;
        })
        .join('');
    }).concat(
      // If codeToTokens produces fewer lines than splitting (rare), pad with raw.
      lines.length > tokens.length ? lines.slice(tokens.length).map(escapeHtml) : []
    );
  } catch {
    return code.split('\n').map(escapeHtml);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

ctx.addEventListener('message', async (e: MessageEvent<Req>) => {
  const { id, lang, code } = e.data;
  try {
    const h = await getHighlighter();
    if (lang !== 'text') await ensureLang(h, lang);
    const tokens =
      lang === 'text' || !loadedLangs.has(lang)
        ? code.split('\n').map(escapeHtml)
        : tokenize(h, lang, code);
    const res: Res = { id, ok: true, tokens };
    ctx.postMessage(res);
  } catch (err) {
    const res: Res = { id, ok: false, error: (err as Error).message };
    ctx.postMessage(res);
  }
});
