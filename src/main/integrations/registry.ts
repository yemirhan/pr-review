import { clickupIntegration } from './clickup';
import { jenkinsIntegration } from './jenkins';
import type { Integration } from './types';

export const integrations: Integration[] = [clickupIntegration, jenkinsIntegration];
