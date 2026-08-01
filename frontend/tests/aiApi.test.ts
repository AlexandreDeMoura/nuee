import { describe, expect, it } from 'vitest';
import {
  assertAiCapabilities,
  createAiApi,
  type AiRequest,
} from '../src/api/ai';

describe('AI capabilities API', () => {
  it('loads and validates provider-neutral capabilities with abort support', async () => {
    const signal = new AbortController().signal;
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const request: AiRequest = <T>(
      path: string,
      init?: RequestInit,
    ): Promise<T> => {
      calls.push({ path, init });
      return Promise.resolve({ web_search: true } as T);
    };

    await expect(createAiApi(request).getAiCapabilities(signal)).resolves.toEqual(
      { web_search: true },
    );
    expect(calls).toEqual([
      { path: '/ai-capabilities', init: { signal } },
    ]);
  });

  it('rejects malformed capability responses', () => {
    for (const response of [null, {}, { web_search: 'true' }]) {
      expect(() => assertAiCapabilities(response)).toThrow(
        'The AI capabilities response contained invalid data.',
      );
    }
  });
});
