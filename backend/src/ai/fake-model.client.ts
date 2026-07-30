import { Injectable } from '@nestjs/common';
import type {
  GenerateAnswerInput,
  GenerateTitleInput,
  ModelClient,
  ModelGeneration,
  ModelMessage,
  StructuredModelGeneration,
} from './model-client';
import { GENERATED_TITLE_MAX_LENGTH } from './model-client';

export const FAKE_MODEL_ID = 'nuee-deterministic-fake';
export const FAKE_TITLE_MAX_LENGTH = GENERATED_TITLE_MAX_LENGTH;
export const FAKE_STRUCTURED_PROPOSAL = {
  title: 'Deterministic knowledge proposal',
  summary: 'A grounded proposal synthesized from the selected sources.',
  content:
    'This deterministic proposal represents one reusable knowledge unit grounded in the selected discussion sources.',
};

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function lastUserMessage(
  messages: readonly ModelMessage[],
): string | undefined {
  return messages.findLast((message) => message.role === 'user')?.content;
}

function firstUserMessage(
  messages: readonly ModelMessage[],
): string | undefined {
  return messages.find((message) => message.role === 'user')?.content;
}

function truncateTitle(value: string): string {
  if (value.length <= FAKE_TITLE_MAX_LENGTH) {
    return value;
  }

  return `${value.slice(0, FAKE_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

@Injectable()
export class FakeModelClient implements ModelClient {
  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration> {
    const prompt = normalizeWhitespace(lastUserMessage(input.messages) ?? '');
    const content = prompt
      ? `Deterministic answer: ${prompt}`
      : 'Deterministic answer: No user question was provided.';

    return Promise.resolve({
      content,
      model: FAKE_MODEL_ID,
    });
  }

  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration> {
    const firstPrompt = normalizeWhitespace(
      firstUserMessage(input.messages) ?? '',
    );
    const content = truncateTitle(firstPrompt || 'Untitled discussion');

    return Promise.resolve({
      content,
      model: FAKE_MODEL_ID,
    });
  }

  generateStructuredOutput(): Promise<StructuredModelGeneration> {
    return Promise.resolve({
      output: { ...FAKE_STRUCTURED_PROPOSAL },
      model: FAKE_MODEL_ID,
    });
  }
}
