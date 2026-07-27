import type { DiscussionRole, FrozenContext } from '@nuee/shared-types';

export interface ModelMessage {
  role: DiscussionRole;
  content: string;
}

export interface GenerateAnswerInput {
  frozenContext: FrozenContext;
  messages: readonly ModelMessage[];
}

export interface GenerateTitleInput {
  messages: readonly ModelMessage[];
}

export interface ModelGeneration {
  content: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ModelClient {
  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration>;
  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration>;
}

export const GENERATED_TITLE_MAX_LENGTH = 60;
export const MODEL_CLIENT = Symbol('MODEL_CLIENT');
