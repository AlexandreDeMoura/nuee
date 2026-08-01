import { createAiCapabilities } from './ai-capabilities';

describe('AI capabilities', () => {
  it('exposes web search only when the provider supports it and the kill switch is enabled', () => {
    expect(
      createAiCapabilities({ provider: 'openai', webSearchEnabled: true }),
    ).toEqual({ web_search: true });
    expect(
      createAiCapabilities({ provider: 'openai', webSearchEnabled: false }),
    ).toEqual({ web_search: false });
  });
});
