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
  webSearchEnabled: false,
  focusedResponseWordBudget: 200,
  modelInputTokenLimit: 128_000,
  reservedOutputTokens: 4_000,
  inputSafetyMarginTokens: 8_000,
  requestTimeoutMs: 60_000,
  webSearchRequestTimeoutMs: 300_000,
};

describe('OpenAiModelClient', () => {
  it('uses the Responses API with frozen context and complete history', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    let options: Parameters<OpenAiResponsesClient['create']>[1] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest, nextOptions) {
        request = nextRequest;
        options = nextOptions;
        return Promise.resolve({
          outputText: '  A focused answer.  ',
          model: 'gpt-5.6-sol-2026-07-01',
          status: 'completed',
          inputTokens: 120,
          outputTokens: 42,
        });
      },
    });
    const formattedContext =
      'FROZEN_DISCUSSION_CONTEXT_V1\nusage=reference_data_only';

    await expect(
      client.generateAnswer({
        formattedContext,
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
    expect(request.input[0].content).toBe(formattedContext);
    expect(request).not.toHaveProperty('max_output_tokens');
    expect(options).toEqual({ maxRetries: 0, timeout: 60_000 });
  });

  it('offers web search for an opted-in answer and maps its citations', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    let options: Parameters<OpenAiResponsesClient['create']>[1] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest, nextOptions) {
        request = nextRequest;
        options = nextOptions;
        return Promise.resolve({
          outputText: 'A current answer with sources.',
          output: [
            { type: 'web_search_call' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  annotations: [
                    {
                      type: 'url_citation',
                      url: 'https://example.com/first',
                      title: 'First source',
                    },
                    {
                      type: 'file_citation',
                      url: 'https://example.com/ignored',
                      title: 'Ignored annotation',
                    },
                    {
                      type: 'url_citation',
                      url: 'https://example.com/second',
                      title: 'Second source',
                    },
                  ],
                },
              ],
            },
          ],
          model: 'gpt-5.6-sol',
          status: 'completed',
        });
      },
    });

    await expect(
      client.generateAnswer({
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [{ role: 'user', content: 'What changed today?' }],
        webSearch: true,
      }),
    ).resolves.toEqual({
      content: 'A current answer with sources.',
      model: 'gpt-5.6-sol',
      webSearchUsed: true,
      citations: [
        {
          url: 'https://example.com/first',
          title: 'First source',
        },
        {
          url: 'https://example.com/second',
          title: 'Second source',
        },
      ],
    });

    expect(request?.tools).toEqual([{ type: 'web_search' }]);
    expect(options).toEqual({ maxRetries: 0, timeout: 300_000 });
  });

  it('treats web search as optional when the provider does not use it', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest) {
        request = nextRequest;
        return Promise.resolve({
          outputText: 'No search was needed.',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', annotations: [] }],
            },
          ],
          model: 'gpt-5.6-sol',
          status: 'completed',
        });
      },
    });

    await expect(
      client.generateAnswer({
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [{ role: 'user', content: 'Summarize the frozen context.' }],
        webSearch: true,
      }),
    ).resolves.toEqual({
      content: 'No search was needed.',
      model: 'gpt-5.6-sol',
    });

    expect(request?.tools).toEqual([{ type: 'web_search' }]);
  });

  it('reports a web search call even when it produces no citations', async () => {
    const client = new OpenAiModelClient(config, {
      create: jest.fn().mockResolvedValue({
        outputText: 'A searched answer without attributed sources.',
        output: [{ type: 'web_search_call' }],
        model: 'gpt-5.6-sol',
        status: 'completed',
      }),
    });

    await expect(
      client.generateAnswer({
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [{ role: 'user', content: 'What is current?' }],
        webSearch: true,
      }),
    ).resolves.toEqual({
      content: 'A searched answer without attributed sources.',
      model: 'gpt-5.6-sol',
      webSearchUsed: true,
    });
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
    expect(request.instructions).toContain('at most 60 characters');
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

  it('requests and parses strict structured output', async () => {
    let request: Parameters<OpenAiResponsesClient['create']>[0] | undefined;
    const client = new OpenAiModelClient(config, {
      create(nextRequest) {
        request = nextRequest;
        return Promise.resolve({
          outputText:
            '{"title":"Grounded title","summary":"One sentence.","content":"Grounded content."}',
          model: 'gpt-5.6-sol',
          status: 'completed',
          inputTokens: 50,
          outputTokens: 20,
        });
      },
    });
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['title', 'summary', 'content'],
    };

    await expect(
      client.generateStructuredOutput({
        instructions: 'Create one grounded proposal.',
        messages: [{ role: 'user', content: 'Selected source data' }],
        format: {
          name: 'knowledge_proposal',
          description: 'One knowledge proposal.',
          schema,
        },
      }),
    ).resolves.toEqual({
      output: {
        title: 'Grounded title',
        summary: 'One sentence.',
        content: 'Grounded content.',
      },
      model: 'gpt-5.6-sol',
      inputTokens: 50,
      outputTokens: 20,
    });

    expect(request).toEqual({
      model: 'gpt-5.6-sol',
      instructions: 'Create one grounded proposal.',
      input: [{ role: 'user', content: 'Selected source data' }],
      text: {
        format: {
          type: 'json_schema',
          name: 'knowledge_proposal',
          description: 'One knowledge proposal.',
          strict: true,
          schema,
        },
      },
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
          formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
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
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_response',
    });
  });

  it('rejects malformed structured output after a completed response', async () => {
    const client = new OpenAiModelClient(config, {
      create: jest.fn().mockResolvedValue({
        outputText: 'not-json',
        model: 'gpt-5.6-sol',
        status: 'completed',
      }),
    });

    await expect(
      client.generateStructuredOutput({
        instructions: 'Return JSON.',
        messages: [{ role: 'user', content: 'Source' }],
        format: {
          name: 'proposal',
          description: 'A proposal.',
          schema: { type: 'object' },
        },
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_response',
    });
  });
});
