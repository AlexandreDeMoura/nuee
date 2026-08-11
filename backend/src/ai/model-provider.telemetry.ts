import { Logger } from '@nestjs/common';
import type { ModelGenerationErrorReason } from './model-client';

export type ModelProviderOperation =
  'answer' | 'answer_with_web_search' | 'title' | 'structured_output';

export interface ModelProviderFailureEvent {
  event: 'model_generation_failed';
  provider: 'openai';
  operation: ModelProviderOperation;
  stage: 'preflight' | 'request' | 'response';
  model: string;
  reason: ModelGenerationErrorReason;
  status: number | null;
  error_type: string | null;
  error_code: string | null;
  request_id: string | null;
  schema_name: string | null;
  schema_keyword: string | null;
}

export interface ModelProviderFailureReporter {
  recordFailure(event: ModelProviderFailureEvent): void;
}

const FAILURE_EVENT_KEYS = [
  'event',
  'provider',
  'operation',
  'stage',
  'model',
  'reason',
  'status',
  'error_type',
  'error_code',
  'request_id',
  'schema_name',
  'schema_keyword',
] as const;

/** Exact allowlist: prompts, model output, and provider error bodies stay out of logs. */
export function assertPrivacySafeModelProviderFailure(event: unknown): void {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Model provider failure log must be an object.');
  }

  const actual = Object.keys(event).sort();
  const expected = [...FAILURE_EVENT_KEYS].sort();

  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError('Model provider failure log has unsafe properties.');
  }

  for (const value of Object.values(event)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ) {
      throw new TypeError('Model provider failure log has unsafe values.');
    }
  }
}

export class ModelProviderTelemetry implements ModelProviderFailureReporter {
  private readonly logger = new Logger('AI');

  recordFailure(event: ModelProviderFailureEvent): void {
    assertPrivacySafeModelProviderFailure(event);
    this.logger.error(event);
  }
}
