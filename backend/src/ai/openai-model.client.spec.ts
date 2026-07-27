import type { AiConfig } from '../config/configuration';
import {
  buildFocusedResponseInstructions,
  ModelProviderError,
  OpenAiModelClient,
  type OpenAiResponsesClient,
} from './openai-model.client';

const config: AiConfig = {
  provider: 'openai',
  model: 'gpt-5.6-sol',
  apiKey: 'test-key',
  focusedResponseWordBudget: 200,
  requestTimeoutMs: 60_000,
};

describe('OpenAiModelClient', () => {
  it('uses the Responses API with frozen context and complete history', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest) {
        request = nextRequest;
        return Promise.resolve({
          outputText: '  A focused answer.  ',
          model: 'gpt-5.6-sol-2026-07-01',
          status: 'completed',
          inputTokens: 120,
          outputTokens: 42,
        });
      },
    });
    const frozenContext = {
      project_description: {
        content: 'A frozen description.',
      },
      bubbles: [{ id: 'bubble-1', content: 'A frozen bubble.' }],
    };

    await expect(
      client.generateAnswer({
        frozenContext,
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Follow-up question' },
        ],
      }),
    ).resolves.toEqual({
      content: 'A focused answer.',
      model: 'gpt-5.6-sol-2026-07-01',
      inputTokens: 120,
      outputTokens: 42,
    });

    if (!request) {
      throw new Error('The Responses client was not called.');
    }

    expect(request).toEqual({
      model: 'gpt-5.6-sol',
      instructions: buildFocusedResponseInstructions(200),
      input: [
        {
          role: 'developer',
          content: request.input[0].content,
        },
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow-up question' },
      ],
    });
    expect(request.input[0].content).toContain(JSON.stringify(frozenContext));
    expect(request).not.toHaveProperty('max_output_tokens');
  });

  it('uses a dedicated concise-title instruction', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest) {
        request = nextRequest;
        return Promise.resolve({
          outputText: 'Launch sequencing risks',
          model: 'gpt-5.6-sol',
          status: 'completed',
        });
      },
    });

    await client.generateTitle({
      messages: [
        { role: 'user', content: 'What are the launch sequencing risks?' },
        { role: 'assistant', content: 'The first risk is...' },
      ],
    });

    if (!request) {
      throw new Error('The Responses client was not called.');
    }

    expect(request.instructions).toContain('single-line title');
    expect(request).toEqual({
      model: 'gpt-5.6-sol',
      instructions: request.instructions,
      input: [
        {
          role: 'user',
          content: 'What are the launch sequencing risks?',
        },
        { role: 'assistant', content: 'The first risk is...' },
      ],
    });
  });

  it.each([
    [
      Object.assign(new Error('request timed out'), {
        name: 'APIConnectionTimeoutError',
      }),
      'timeout',
    ],
    [new Error('provider unavailable'), 'provider'],
  ] as const)(
    'classifies rejected Responses requests without exposing provider errors',
    async (error, reason) => {
      const responsesClient: OpenAiResponsesClient = {
        create: jest.fn().mockRejectedValue(error),
      };
      const client = new OpenAiModelClient(config, responsesClient);

      await expect(
        client.generateAnswer({
          frozenContext: {},
          messages: [{ role: 'user', content: 'Question' }],
        }),
      ).rejects.toMatchObject({
        constructor: ModelProviderError,
        reason,
        message: 'The model provider could not generate a valid response.',
      });
    },
  );

  it.each([
    { outputText: '', model: 'gpt-5.6-sol', status: 'completed' },
    {
      outputText: 'Partial answer',
      model: 'gpt-5.6-sol',
      status: 'incomplete',
    },
  ])('rejects incomplete or empty provider responses', async (response) => {
    const client = new OpenAiModelClient(config, {
      create: jest.fn().mockResolvedValue(response),
    });

    await expect(
      client.generateAnswer({
        frozenContext: {},
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_response',
    });
  });
});
