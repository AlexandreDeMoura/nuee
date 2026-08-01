import type { AiCapabilities } from '@nuee/shared-types';
import type { AiConfig } from '../config/configuration';

type CapabilityConfig = Pick<AiConfig, 'provider' | 'webSearchEnabled'>;

export function createAiCapabilities(config: CapabilityConfig): AiCapabilities {
  return {
    web_search: config.provider === 'openai' && config.webSearchEnabled,
  };
}

export const AI_CAPABILITIES = Symbol('AI_CAPABILITIES');
