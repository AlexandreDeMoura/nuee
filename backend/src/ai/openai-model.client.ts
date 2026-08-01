import OpenAI from 'openai';
import type { ResponseOutputItem } from 'openai/resources/responses/responses';
import type { MessageCitation } from '@nuee/shared-types';
import type { AiConfig } from '../config/configuration';
import {
  buildFocusedResponseInstructions,
  TITLE_INSTRUCTIONS,
} from './answer-instructions';
import type {
  GenerateAnswerInput,
  GenerateStructuredOutputInput,
  GenerateTitleInput,
  ModelClient,
  ModelGeneration,
  ModelMessage,
  StructuredModelGeneration,
} from './model-client';
export { buildFocusedResponseInstructions } from './answer-instructions';

interface OpenAiInputMessage {
  role: 'developer' | 'user' | 'assistant';
  content: string;
}

interface OpenAiResponseRequest {
  model: string;
  instructions: string;
  input: OpenAiInputMessage[];
  tools?: Array<{
    type: 'web_search';
  }>;
  text?: {
    format: {
      type: 'json_schema';
      name: string;
      description: string;
      strict: true;
      schema: Record<string, unknown>;
    };
  };
}

interface OpenAiOutputAnnotation {
  type: string;
  url?: unknown;
  title?: unknown;
}

interface OpenAiOutputContent {
  type: string;
  annotations?: OpenAiOutputAnnotation[];
}

interface OpenAiOutputItem {
  type: string;
  content?: OpenAiOutputContent[];
}

interface OpenAiResponse {
  outputText: string;
  output?: OpenAiOutputItem[];
  model: string;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OpenAiResponsesClient {
  create(request: OpenAiResponseRequest): Promise<OpenAiResponse>;
}

export class ModelProviderError extends Error {
  constructor(
    readonly reason: 'provider' | 'timeout' | 'invalid_response',
    options?: ErrorOptions,
  ) {
    super('The model provider could not generate a valid response.', options);
    this.name = 'ModelProviderError';
  }
}

const WEB_SEARCH_TOOL = { type: 'web_search' } as const;

function frozenContextMessage(
  formattedContext: GenerateAnswerInput['formattedContext'],
): OpenAiInputMessage {
  return {
    role: 'developer',
    content: formattedContext,
  };
}

function transcriptMessages(
  messages: readonly ModelMessage[],
): OpenAiInputMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof OpenAI.APIConnectionTimeoutError ||
    (error instanceof Error && error.name === 'APIConnectionTimeoutError')
  );
}

function mapResponseOutput(
  output: readonly ResponseOutputItem[],
): OpenAiOutputItem[] {
  return output.map((item) => {
    if (item.type !== 'message') {
      return { type: item.type };
    }

    return {
      type: item.type,
      content: item.content.map((content) => {
        if (content.type !== 'output_text') {
          return { type: content.type };
        }

        return {
          type: content.type,
          annotations: content.annotations.map((annotation) =>
            annotation.type === 'url_citation'
              ? {
                  type: annotation.type,
                  url: annotation.url,
                  title: annotation.title,
                }
              : { type: annotation.type },
          ),
        };
      }),
    };
  });
}

function hasWebSearchCall(output: readonly OpenAiOutputItem[]): boolean {
  return output.some((item) => item.type === 'web_search_call');
}

function mapCitations(output: readonly OpenAiOutputItem[]): MessageCitation[] {
  const citations: MessageCitation[] = [];

  for (const item of output) {
    if (item.type !== 'message') {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type !== 'output_text') {
        continue;
      }

      for (const annotation of content.annotations ?? []) {
        if (
          annotation.type === 'url_citation' &&
          typeof annotation.url === 'string' &&
          typeof annotation.title === 'string'
        ) {
          citations.push({
            url: annotation.url,
            title: annotation.title,
          });
        }
      }
    }
  }

  return citations;
}

function createResponsesClient(config: AiConfig): OpenAiResponsesClient {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.requestTimeoutMs,
  });

  return {
    async create(request): Promise<OpenAiResponse> {
      const response = await client.responses.create(request);

      return {
        outputText: response.output_text,
        output: mapResponseOutput(response.output),
        model: response.model,
        status: response.status,
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      };
    },
  };
}

export class OpenAiModelClient implements ModelClient {
  private readonly responsesClient: OpenAiResponsesClient;

  constructor(
    private readonly config: AiConfig,
    responsesClient?: OpenAiResponsesClient,
  ) {
    this.responsesClient = responsesClient ?? createResponsesClient(config);
  }

  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration> {
    return this.generate(
      {
        model: this.config.model,
        instructions: buildFocusedResponseInstructions(
          this.config.focusedResponseWordBudget,
        ),
        input: [
          frozenContextMessage(input.formattedContext),
          ...transcriptMessages(input.messages),
        ],
        ...(input.webSearch ? { tools: [{ ...WEB_SEARCH_TOOL }] } : {}),
      },
      true,
    );
  }

  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration> {
    return this.generate({
      model: this.config.model,
      instructions: TITLE_INSTRUCTIONS,
      input: transcriptMessages(input.messages),
    });
  }

  async generateStructuredOutput(
    input: GenerateStructuredOutputInput,
  ): Promise<StructuredModelGeneration> {
    const generation = await this.generate({
      model: this.config.model,
      instructions: input.instructions,
      input: transcriptMessages(input.messages),
      text: {
        format: {
          type: 'json_schema',
          name: input.format.name,
          description: input.format.description,
          strict: true,
          schema: input.format.schema,
        },
      },
    });
    let output: unknown;

    try {
      output = JSON.parse(generation.content) as unknown;
    } catch (error) {
      throw new ModelProviderError('invalid_response', { cause: error });
    }

    return {
      output,
      model: generation.model,
      inputTokens: generation.inputTokens,
      outputTokens: generation.outputTokens,
    };
  }

  private async generate(
    request: OpenAiResponseRequest,
    mapWebSearchMetadata = false,
  ): Promise<ModelGeneration> {
    let response: OpenAiResponse;

    try {
      response = await this.responsesClient.create(request);
    } catch (error) {
      throw new ModelProviderError(isTimeout(error) ? 'timeout' : 'provider', {
        cause: error,
      });
    }

    const content = response.outputText.trim();

    if (response.status !== 'completed' || !content) {
      throw new ModelProviderError('invalid_response');
    }

    const generation: ModelGeneration = {
      content,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    };

    if (!mapWebSearchMetadata) {
      return generation;
    }

    const output = response.output ?? [];
    const citations = mapCitations(output);

    if (hasWebSearchCall(output)) {
      generation.webSearchUsed = true;
    }

    if (citations.length > 0) {
      generation.citations = citations;
    }

    return generation;
  }
}
