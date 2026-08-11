import OpenAI from 'openai';
import type { ResponseOutputItem } from 'openai/resources/responses/responses';
import type { MessageCitation } from '@nuee/shared-types';
import type { AiConfig } from '../config/configuration';
import {
  buildFocusedResponseInstructions,
  TITLE_INSTRUCTIONS,
} from './answer-instructions';
import { ModelGenerationError } from './model-client';
import type {
  GenerateAnswerInput,
  GenerateStructuredOutputInput,
  GenerateTitleInput,
  ModelClient,
  ModelGeneration,
  ModelMessage,
  StructuredModelGeneration,
} from './model-client';
import type {
  ModelProviderFailureEvent,
  ModelProviderFailureReporter,
  ModelProviderOperation,
} from './model-provider.telemetry';
import { ModelProviderTelemetry } from './model-provider.telemetry';
import {
  assertOpenAiStructuredOutputFormat,
  OpenAiStructuredOutputFormatError,
} from './openai-structured-output';
export { buildFocusedResponseInstructions } from './answer-instructions';
export { ModelGenerationError as ModelProviderError } from './model-client';

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
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface OpenAiResponsesClient {
  create(
    request: OpenAiResponseRequest,
    options: { maxRetries: 0; timeout: number },
  ): Promise<OpenAiResponse>;
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

interface OpenAiApiErrorMetadata {
  status: number | null;
  type: string | null;
  code: string | null;
  requestId: string | null;
}

function apiErrorMetadata(error: unknown): OpenAiApiErrorMetadata | null {
  if (!(error instanceof OpenAI.APIError)) {
    return null;
  }

  const record = error as unknown as Record<string, unknown>;

  return {
    status: typeof record.status === 'number' ? record.status : null,
    type: typeof record.type === 'string' ? record.type : null,
    code: typeof record.code === 'string' ? record.code : null,
    requestId: typeof record.requestID === 'string' ? record.requestID : null,
  };
}

function generationFailureReason(
  error: unknown,
): ModelGenerationError['reason'] {
  if (isTimeout(error)) {
    return 'timeout';
  }

  const status = apiErrorMetadata(error)?.status;
  if (
    status !== null &&
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 429].includes(status)
  ) {
    return 'invalid_request';
  }

  return 'provider';
}

function requestFailureEvent(
  error: unknown,
  operation: ModelProviderOperation,
  model: string,
  reason: ModelGenerationError['reason'],
): ModelProviderFailureEvent {
  const providerError = apiErrorMetadata(error);

  return {
    event: 'model_generation_failed',
    provider: 'openai',
    operation,
    stage: 'request',
    model,
    reason,
    status: providerError?.status ?? null,
    error_type: providerError?.type ?? null,
    error_code: providerError?.code ?? null,
    request_id: providerError?.requestId ?? null,
    schema_name: null,
    schema_keyword: null,
  };
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
    maxRetries: 0,
    timeout: config.requestTimeoutMs,
  });

  return {
    async create(request, options): Promise<OpenAiResponse> {
      const response = await client.responses.create(request, options);

      return {
        outputText: response.output_text,
        output: mapResponseOutput(response.output),
        model: response.model,
        status: response.status,
        requestId: response._request_id ?? undefined,
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
    private readonly failureReporter: ModelProviderFailureReporter = new ModelProviderTelemetry(),
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
      input.webSearch ? 'answer_with_web_search' : 'answer',
      true,
      input.webSearch
        ? this.config.webSearchRequestTimeoutMs
        : this.config.requestTimeoutMs,
    );
  }

  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration> {
    return this.generate(
      {
        model: this.config.model,
        instructions: TITLE_INSTRUCTIONS,
        input: transcriptMessages(input.messages),
      },
      'title',
    );
  }

  async generateStructuredOutput(
    input: GenerateStructuredOutputInput,
  ): Promise<StructuredModelGeneration> {
    try {
      assertOpenAiStructuredOutputFormat(input.format);
    } catch (error) {
      const formatError =
        error instanceof OpenAiStructuredOutputFormatError ? error : null;
      this.failureReporter.recordFailure({
        event: 'model_generation_failed',
        provider: 'openai',
        operation: 'structured_output',
        stage: 'preflight',
        model: this.config.model,
        reason: 'invalid_request',
        status: null,
        error_type: 'structured_output_format',
        error_code: formatError?.code ?? null,
        request_id: null,
        schema_name:
          formatError?.code === 'invalid_format_name'
            ? null
            : input.format.name,
        schema_keyword: formatError?.keyword ?? null,
      });
      throw new ModelGenerationError('invalid_request', { cause: error });
    }

    const generation = await this.generate(
      {
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
      },
      'structured_output',
    );
    let output: unknown;

    try {
      output = JSON.parse(generation.content) as unknown;
    } catch (error) {
      this.failureReporter.recordFailure({
        event: 'model_generation_failed',
        provider: 'openai',
        operation: 'structured_output',
        stage: 'response',
        model: this.config.model,
        reason: 'invalid_response',
        status: null,
        error_type: 'invalid_response',
        error_code: 'invalid_json_output',
        request_id: null,
        schema_name: input.format.name,
        schema_keyword: null,
      });
      throw new ModelGenerationError('invalid_response', { cause: error });
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
    operation: ModelProviderOperation,
    mapWebSearchMetadata = false,
    timeoutMs = this.config.requestTimeoutMs,
  ): Promise<ModelGeneration> {
    let response: OpenAiResponse;

    try {
      response = await this.responsesClient.create(request, {
        maxRetries: 0,
        timeout: timeoutMs,
      });
    } catch (error) {
      const reason = generationFailureReason(error);
      this.failureReporter.recordFailure(
        requestFailureEvent(error, operation, this.config.model, reason),
      );
      throw new ModelGenerationError(reason, { cause: error });
    }

    const content = response.outputText.trim();

    if (response.status !== 'completed' || !content) {
      this.failureReporter.recordFailure({
        event: 'model_generation_failed',
        provider: 'openai',
        operation,
        stage: 'response',
        model: this.config.model,
        reason: 'invalid_response',
        status: null,
        error_type: 'invalid_response',
        error_code:
          response.status !== 'completed'
            ? (response.status ?? 'missing_status')
            : 'empty_output',
        request_id: response.requestId ?? null,
        schema_name: request.text?.format.name ?? null,
        schema_keyword: null,
      });
      throw new ModelGenerationError('invalid_response');
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
