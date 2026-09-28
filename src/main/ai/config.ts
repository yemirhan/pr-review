import Store from 'electron-store';
import type { AIConfig, AIClaudeModel, AILanguage, AIProvider, AIReviewDepth } from '@shared/types';

export const CLAUDE_MODELS: AIClaudeModel[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', description: 'Default. Strongest reviewer.' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Newest Opus.' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Faster and cheaper.' }
];

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';
/** Model used for Claude "quick" reviews. */
export const QUICK_CLAUDE_MODEL = 'claude-sonnet-5';

const store = new Store<AIConfig>({
  name: 'ai',
  defaults: {
    provider: 'codex',
    codexModel: null,
    codexReasoningEffort: null,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    depth: 'thorough',
    autoReview: false,
    language: 'tr',
    directive: null
  }
});

const PROVIDERS: AIProvider[] = ['claude', 'codex'];
const LANGUAGES: AILanguage[] = ['en', 'tr'];
const DEPTHS: AIReviewDepth[] = ['quick', 'thorough'];

export function getAIConfig(): AIConfig {
  const provider = store.get('provider', 'codex');
  const language = store.get('language', 'tr');
  const depth = store.get('depth', 'thorough');
  return {
    provider: PROVIDERS.includes(provider) ? provider : 'codex',
    codexModel: store.get('codexModel', null) || null,
    codexReasoningEffort: store.get('codexReasoningEffort', null) || null,
    claudeModel: store.get('claudeModel', DEFAULT_CLAUDE_MODEL) || DEFAULT_CLAUDE_MODEL,
    depth: DEPTHS.includes(depth) ? depth : 'thorough',
    autoReview: store.get('autoReview', false) === true,
    language: LANGUAGES.includes(language) ? language : 'tr',
    directive: store.get('directive', null) || null
  };
}

export function setAIConfig(patch: Partial<AIConfig>): AIConfig {
  if (patch.provider !== undefined && PROVIDERS.includes(patch.provider)) {
    store.set('provider', patch.provider);
  }
  if (patch.codexModel !== undefined) {
    store.set('codexModel', patch.codexModel?.trim() || null);
  }
  if (patch.codexReasoningEffort !== undefined) {
    store.set('codexReasoningEffort', patch.codexReasoningEffort?.trim() || null);
  }
  if (patch.claudeModel !== undefined) {
    store.set('claudeModel', patch.claudeModel?.trim() || DEFAULT_CLAUDE_MODEL);
  }
  if (patch.depth !== undefined && DEPTHS.includes(patch.depth)) {
    store.set('depth', patch.depth);
  }
  if (patch.autoReview !== undefined) {
    store.set('autoReview', patch.autoReview === true);
  }
  if (patch.language !== undefined && LANGUAGES.includes(patch.language)) {
    store.set('language', patch.language);
  }
  if (patch.directive !== undefined) {
    store.set('directive', patch.directive?.trim() || null);
  }
  return getAIConfig();
}
