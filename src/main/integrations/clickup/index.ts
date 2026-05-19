import type { Integration } from '../types';

/**
 * Read-only ClickUp integration: surfaces the linked task in the UI but never
 * mutates ClickUp state. Automation was removed intentionally.
 */
export const clickupIntegration: Integration = {
  id: 'clickup',
  label: 'ClickUp'
};
