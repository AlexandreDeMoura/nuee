import { Logger } from '@nestjs/common';
import {
  ModelProviderTelemetry,
  assertPrivacySafeModelProviderFailure,
  type ModelProviderFailureEvent,
} from './model-provider.telemetry';

const safeEvent: ModelProviderFailureEvent = {
  event: 'model_generation_failed',
  provider: 'openai',
  operation: 'structured_output',
  stage: 'request',
  model: 'configured-model',
  reason: 'invalid_request',
  status: 400,
  error_type: 'invalid_request_error',
  error_code: 'invalid_json_schema',
  request_id: 'req_123',
  schema_name: null,
  schema_keyword: null,
};

describe('ModelProviderTelemetry privacy boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['message', 'Private provider message'],
    ['prompt', 'Private prompt contents'],
    ['error_body', { message: 'Private provider body' }],
  ])('rejects the sensitive %s property', (property, value) => {
    expect(() =>
      assertPrivacySafeModelProviderFailure({
        ...safeEvent,
        [property]: value,
      }),
    ).toThrow(/unsafe properties/u);
  });

  it('rejects non-scalar data hidden in an allowlisted property', () => {
    expect(() =>
      assertPrivacySafeModelProviderFailure({
        ...safeEvent,
        error_code: { message: 'Private provider body' },
      }),
    ).toThrow(/unsafe values/u);
  });

  it('writes only the allowlisted structured event', () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    new ModelProviderTelemetry().recordFailure(safeEvent);

    expect(log).toHaveBeenCalledWith(safeEvent);
  });
});
