import type { DiscussionRole, MessageCitation } from '@nuee/shared-types';

export interface ModelMessage {
  role: DiscussionRole;
  content: string;
}

export interface GenerateAnswerInput {
  formattedContext: string;
  messages: readonly ModelMessage[];
  webSearch?: boolean;
}

export interface GenerateTitleInput {
  messages: readonly ModelMessage[];
}

export interface StructuredOutputFormat {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface GenerateStructuredOutputInput {
  instructions: string;
  messages: readonly ModelMessage[];
  format: StructuredOutputFormat;
}

export interface ModelGeneration {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearchUsed?: boolean;
  citations?: MessageCitation[];
}

export interface StructuredModelGeneration {
  output: unknown;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelClient {
  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration>;
  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration>;
  generateStructuredOutput(
    input: GenerateStructuredOutputInput,
  ): Promise<StructuredModelGeneration>;
}

export const GENERATED_TITLE_MAX_LENGTH = 60;
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
