import { clickupIntegration } from './clickup';
import { jenkinsIntegration } from './jenkins';
import { vercelIntegration } from './vercel';
import type { Integration } from './types';

export const integrations: Integration[] = [
  clickupIntegration,
  jenkinsIntegration,
  vercelIntegration
];
