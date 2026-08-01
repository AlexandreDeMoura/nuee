import type { AiCapabilities } from '@nuee/shared-types';
import { requestJson } from './client';

export type { AiCapabilities };

export type AiRequest = typeof requestJson;

const INVALID_CAPABILITIES_MESSAGE =
  'The AI capabilities response contained invalid data.';

export function isAiCapabilities(value: unknown): value is AiCapabilities {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).web_search === 'boolean'
  );
}

export function assertAiCapabilities(value: unknown): AiCapabilities {
  if (!isAiCapabilities(value)) {
    throw new Error(INVALID_CAPABILITIES_MESSAGE);
  }

  return value;
}

export function createAiApi(request: AiRequest = requestJson) {
  function getAiCapabilities(signal?: AbortSignal): Promise<AiCapabilities> {
    return request<unknown>('/ai-capabilities', { signal }).then(
      assertAiCapabilities,
    );
  }

  return { getAiCapabilities };
}

export const { getAiCapabilities } = createAiApi();
