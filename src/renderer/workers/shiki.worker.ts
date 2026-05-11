/// <reference lib="webworker" />
import { createHighlighter, type Highlighter } from 'shiki';

export type ShikiTheme = 'github-dark' | 'github-light';

type Req = { id: number; lang: string; code: string; theme: ShikiTheme };
type Res =
  | { id: number; ok: true; tokens: string[] }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let highlighterP: Promise<Highlighter> | null = null;

const PRELOAD_LANGS = ['typescript', 'tsx', 'javascript', 'jsx', 'json', 'markdown', 'shell'];
const THEMES: ShikiTheme[] = ['github-dark', 'github-light'];

function getHighlighter() {
  if (!highlighterP) {
    highlighterP = createHighlighter({
      themes: THEMES,
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

function tokenize(h: Highlighter, lang: string, code: string, theme: ShikiTheme): string[] {
  try {
    const lines = code.split('\n');
    const { tokens } = h.codeToTokens(code, { lang: lang as never, theme });
    return tokens
      .map((lineTokens) =>
        lineTokens
          .map((t) => {
            const color = t.color ? `color:${t.color}` : '';
            const safe = escapeHtml(t.content);
            return `<span style="${color}">${safe}</span>`;
          })
          .join('')
      )
      .concat(
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
  const { id, lang, code, theme } = e.data;
  try {
    const h = await getHighlighter();
    if (lang !== 'text') await ensureLang(h, lang);
    const tokens =
      lang === 'text' || !loadedLangs.has(lang)
        ? code.split('\n').map(escapeHtml)
        : tokenize(h, lang, code, theme);
    const res: Res = { id, ok: true, tokens };
    ctx.postMessage(res);
  } catch (err) {
    const res: Res = { id, ok: false, error: (err as Error).message };
    ctx.postMessage(res);
  }
});
