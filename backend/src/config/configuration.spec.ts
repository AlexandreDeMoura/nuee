import {
  createAiConfig,
  createAppConfig,
  validateEnvironment,
} from './configuration';

describe('configuration', () => {
  it('provides typed local defaults and does not require a key in tests', () => {
    expect(createAppConfig({ NODE_ENV: 'test' })).toEqual({
      environment: 'test',
      port: 3000,
      frontendOrigin: 'http://localhost:5173',
      databasePath: undefined,
    });
    expect(createAiConfig({ NODE_ENV: 'test' })).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-sol',
      apiKey: '',
      focusedResponseWordBudget: 200,
      modelInputTokenLimit: 128_000,
      reservedOutputTokens: 4_000,
      inputSafetyMarginTokens: 8_000,
      requestTimeoutMs: 60_000,
    });
  });

  it('normalizes explicitly configured values', () => {
    const source = {
      NODE_ENV: 'production',
      PORT: '8080',
      FRONTEND_URL: 'https://nuee.example/',
      PROJECT_DATABASE_PATH: '/data/nuee.sqlite',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'gpt-5.6-terra',
      OPENAI_API_KEY: 'test-secret',
      AI_FOCUSED_RESPONSE_WORD_BUDGET: '240',
      AI_MODEL_INPUT_TOKEN_LIMIT: '200000',
      AI_RESERVED_OUTPUT_TOKENS: '6000',
      AI_INPUT_SAFETY_MARGIN_TOKENS: '10000',
      AI_REQUEST_TIMEOUT_MS: '90000',
    };

    expect(createAppConfig(source)).toEqual({
      environment: 'production',
      port: 8080,
      frontendOrigin: 'https://nuee.example',
      databasePath: '/data/nuee.sqlite',
    });
    expect(createAiConfig(source)).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-terra',
      apiKey: 'test-secret',
      focusedResponseWordBudget: 240,
      modelInputTokenLimit: 200_000,
      reservedOutputTokens: 6_000,
      inputSafetyMarginTokens: 10_000,
      requestTimeoutMs: 90_000,
    });
  });

  it('requires the OpenAI key outside the test environment', () => {
    expect(() => createAiConfig({ NODE_ENV: 'development' })).toThrow(
      'OPENAI_API_KEY is required when NODE_ENV is not "test".',
    );
  });

  it.each([
    [{ NODE_ENV: 'staging' }, 'NODE_ENV must be one of'],
    [{ NODE_ENV: 'test', AI_PROVIDER: 'other' }, 'AI_PROVIDER must be one of'],
    [{ NODE_ENV: 'test', PORT: '0' }, 'PORT must be an integer'],
    [
      { NODE_ENV: 'test', FRONTEND_URL: 'https://nuee.example/path' },
      'FRONTEND_URL must be a valid HTTP or HTTPS origin.',
    ],
    [
      { NODE_ENV: 'test', AI_FOCUSED_RESPONSE_WORD_BUDGET: '20' },
      'AI_FOCUSED_RESPONSE_WORD_BUDGET must be an integer',
    ],
    [
      { NODE_ENV: 'test', AI_MODEL_INPUT_TOKEN_LIMIT: '1000' },
      'AI_MODEL_INPUT_TOKEN_LIMIT must be an integer',
    ],
    [
      {
        NODE_ENV: 'test',
        AI_MODEL_INPUT_TOKEN_LIMIT: '12000',
        AI_RESERVED_OUTPUT_TOKENS: '4000',
        AI_INPUT_SAFETY_MARGIN_TOKENS: '8000',
      },
      'AI_RESERVED_OUTPUT_TOKENS plus AI_INPUT_SAFETY_MARGIN_TOKENS must be less',
    ],
    [
      { NODE_ENV: 'test', AI_REQUEST_TIMEOUT_MS: '999' },
      'AI_REQUEST_TIMEOUT_MS must be an integer',
    ],
  ])('rejects invalid environment values', (source, message) => {
    expect(() => validateEnvironment(source)).toThrow(message);
  });
});
