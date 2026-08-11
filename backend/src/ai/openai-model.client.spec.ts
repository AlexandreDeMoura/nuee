import OpenAI from 'openai';
import type { AiConfig } from '../config/configuration';
import type {
  ModelProviderFailureEvent,
  ModelProviderFailureReporter,
} from './model-provider.telemetry';
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

function collectingFailureReporter(): {
  events: ModelProviderFailureEvent[];
  reporter: ModelProviderFailureReporter;
} {
  const events: ModelProviderFailureEvent[] = [];
  return {
    events,
    reporter: { recordFailure: (event) => events.push(event) },
  };
}

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
      const { events, reporter } = collectingFailureReporter();
      const client = new OpenAiModelClient(config, responsesClient, reporter);

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
      expect(events).toEqual([
        expect.objectContaining({
          operation: 'answer',
          stage: 'request',
          reason,
          status: null,
          error_type: null,
          error_code: null,
          request_id: null,
        }),
      ]);
    },
  );

  it('classifies invalid provider requests and records safe diagnostics', async () => {
    const providerError = new OpenAI.BadRequestError(
      400,
      {
        type: 'invalid_request_error',
        code: 'invalid_json_schema',
        param: 'text.format.schema',
        message: 'Private provider detail that must not be logged.',
      },
      undefined,
      new Headers({ 'x-request-id': 'req_schema_123' }),
    );
    const responsesClient: OpenAiResponsesClient = {
      create: jest.fn().mockRejectedValue(providerError),
    };
    const { events, reporter } = collectingFailureReporter();
    const client = new OpenAiModelClient(config, responsesClient, reporter);

    await expect(
      client.generateTitle({ messages: [{ role: 'user', content: 'Title' }] }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_request',
    });
    expect(events).toEqual([
      {
        event: 'model_generation_failed',
        provider: 'openai',
        operation: 'title',
        stage: 'request',
        model: 'gpt-5.6-sol',
        reason: 'invalid_request',
        status: 400,
        error_type: 'invalid_request_error',
        error_code: 'invalid_json_schema',
        request_id: 'req_schema_123',
        schema_name: null,
        schema_keyword: null,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('Private provider detail');
    expect(JSON.stringify(events)).not.toContain('text.format.schema');
  });

  it('rejects an incompatible strict schema before calling the provider', async () => {
    const create = jest.fn<OpenAiResponsesClient['create']>();
    const { events, reporter } = collectingFailureReporter();
    const client = new OpenAiModelClient(config, { create }, reporter);

    await expect(
      client.generateStructuredOutput({
        instructions: 'Return structured data.',
        messages: [{ role: 'user', content: 'Source' }],
        format: {
          name: 'invalid_schema',
          description: 'An incompatible schema.',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              items: {
                type: 'array',
                uniqueItems: true,
                items: { type: 'string' },
              },
            },
            required: ['items'],
          },
        },
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_request',
    });
    expect(create).not.toHaveBeenCalled();
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'structured_output',
        stage: 'preflight',
        reason: 'invalid_request',
        error_type: 'structured_output_format',
        error_code: 'unsupported_schema_keyword',
        schema_name: 'invalid_schema',
        schema_keyword: 'uniqueItems',
      }),
    ]);
  });

  it.each([
    { outputText: '', model: 'gpt-5.6-sol', status: 'completed' },
    {
      outputText: 'Partial answer',
      model: 'gpt-5.6-sol',
      status: 'incomplete',
    },
  ])('rejects incomplete or empty provider responses', async (response) => {
    const { events, reporter } = collectingFailureReporter();
    const client = new OpenAiModelClient(
      config,
      { create: jest.fn().mockResolvedValue(response) },
      reporter,
    );

    await expect(
      client.generateAnswer({
        formattedContext: 'FROZEN_DISCUSSION_CONTEXT_LEGACY',
        messages: [{ role: 'user', content: 'Question' }],
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_response',
    });
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'answer',
        stage: 'response',
        reason: 'invalid_response',
        error_type: 'invalid_response',
        error_code:
          response.status === 'completed' ? 'empty_output' : response.status,
      }),
    ]);
  });

  it('rejects malformed structured output after a completed response', async () => {
    const { events, reporter } = collectingFailureReporter();
    const client = new OpenAiModelClient(
      config,
      {
        create: jest.fn().mockResolvedValue({
          outputText: 'not-json',
          model: 'gpt-5.6-sol',
          status: 'completed',
        }),
      },
      reporter,
    );

    await expect(
      client.generateStructuredOutput({
        instructions: 'Return JSON.',
        messages: [{ role: 'user', content: 'Source' }],
        format: {
          name: 'proposal',
          description: 'A proposal.',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
        },
      }),
    ).rejects.toMatchObject({
      constructor: ModelProviderError,
      reason: 'invalid_response',
    });
    expect(events).toEqual([
      expect.objectContaining({
        operation: 'structured_output',
        stage: 'response',
        reason: 'invalid_response',
        error_code: 'invalid_json_output',
        schema_name: 'proposal',
      }),
    ]);
  });
});
