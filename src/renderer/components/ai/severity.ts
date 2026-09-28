import type { AIFindingSeverity } from '@shared/types';

export const SEVERITY_LABEL: Record<AIFindingSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

/** Dot / accent-bar colour per severity. Low stays neutral on purpose. */
export const SEVERITY_DOT: Record<AIFindingSeverity, string> = {
  critical: 'bg-danger',
  high: 'bg-danger',
  medium: 'bg-attention',
  low: 'bg-fg-subtle'
};

export const SEVERITY_TEXT: Record<AIFindingSeverity, string> = {
  critical: 'text-danger',
  high: 'text-danger',
  medium: 'text-attention',
  low: 'text-fg-subtle'
};

export const SEVERITY_BORDER: Record<AIFindingSeverity, string> = {
  critical: 'border-l-danger',
  high: 'border-l-danger',
  medium: 'border-l-attention',
  low: 'border-l-border'
};
