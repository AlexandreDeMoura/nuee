import {
  createAiConfig,
  createAppConfig,
  createDocumentsConfig,
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
      webSearchEnabled: false,
      focusedResponseWordBudget: 200,
      modelInputTokenLimit: 128_000,
      reservedOutputTokens: 4_000,
      inputSafetyMarginTokens: 8_000,
      requestTimeoutMs: 60_000,
    });
    expect(createDocumentsConfig({ NODE_ENV: 'test' })).toEqual({
      privateStoragePath: undefined,
      supported_formats: [
        {
          category: 'plain_text',
          extensions: ['.txt'],
          mime_types: ['text/plain'],
        },
        {
          category: 'markdown',
          extensions: ['.md'],
          mime_types: ['text/markdown', 'text/x-markdown', 'text/plain'],
        },
        {
          category: 'pdf',
          extensions: ['.pdf'],
          mime_types: ['application/pdf'],
        },
      ],
      max_file_size_bytes: 10 * 1024 * 1024,
      max_files_per_request: 1,
      max_documents_per_project: 25,
      max_project_storage_bytes: 100 * 1024 * 1024,
      maxPdfPages: 200,
      maxExtractedTextBytes: 16 * 1024 * 1024,
      processingTimeoutMs: 30_000,
      processingLeaseMs: 45_000,
      maxProcessingConcurrency: 2,
      maxProcessingAttempts: 3,
      malwareScannerHost: '127.0.0.1',
      malwareScannerPort: 3310,
      malwareScannerTimeoutMs: 10_000,
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
      AI_WEB_SEARCH_ENABLED: 'true',
      AI_FOCUSED_RESPONSE_WORD_BUDGET: '240',
      AI_MODEL_INPUT_TOKEN_LIMIT: '200000',
      AI_RESERVED_OUTPUT_TOKENS: '6000',
      AI_INPUT_SAFETY_MARGIN_TOKENS: '10000',
      AI_REQUEST_TIMEOUT_MS: '90000',
      DOCUMENT_PRIVATE_STORAGE_PATH: '/data/documents',
      DOCUMENT_MAX_FILE_SIZE_BYTES: '20971520',
      DOCUMENT_MAX_DOCUMENTS_PER_PROJECT: '40',
      DOCUMENT_MAX_PROJECT_STORAGE_BYTES: '209715200',
      DOCUMENT_MAX_PDF_PAGES: '300',
      DOCUMENT_MAX_EXTRACTED_TEXT_BYTES: '25165824',
      DOCUMENT_PROCESSING_TIMEOUT_MS: '45000',
      DOCUMENT_PROCESSING_LEASE_MS: '60000',
      DOCUMENT_PROCESSING_CONCURRENCY: '4',
      DOCUMENT_PROCESSING_MAX_ATTEMPTS: '5',
      DOCUMENT_MALWARE_SCANNER_HOST: 'clamav.internal',
      DOCUMENT_MALWARE_SCANNER_PORT: '3311',
      DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS: '15000',
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
      webSearchEnabled: true,
      focusedResponseWordBudget: 240,
      modelInputTokenLimit: 200_000,
      reservedOutputTokens: 6_000,
      inputSafetyMarginTokens: 10_000,
      requestTimeoutMs: 90_000,
    });
    expect(createDocumentsConfig(source)).toMatchObject({
      privateStoragePath: '/data/documents',
      max_file_size_bytes: 20 * 1024 * 1024,
      max_files_per_request: 1,
      max_documents_per_project: 40,
      max_project_storage_bytes: 200 * 1024 * 1024,
      maxPdfPages: 300,
      maxExtractedTextBytes: 24 * 1024 * 1024,
      processingTimeoutMs: 45_000,
      processingLeaseMs: 60_000,
      maxProcessingConcurrency: 4,
      maxProcessingAttempts: 5,
      malwareScannerHost: 'clamav.internal',
      malwareScannerPort: 3311,
      malwareScannerTimeoutMs: 15_000,
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
    [
      { NODE_ENV: 'test', AI_WEB_SEARCH_ENABLED: 'yes' },
      'AI_WEB_SEARCH_ENABLED must be either true or false.',
    ],
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
    [
      { NODE_ENV: 'test', DOCUMENT_MAX_FILE_SIZE_BYTES: '0' },
      'DOCUMENT_MAX_FILE_SIZE_BYTES must be an integer',
    ],
    [
      {
        NODE_ENV: 'test',
        DOCUMENT_MAX_FILE_SIZE_BYTES: '2048',
        DOCUMENT_MAX_PROJECT_STORAGE_BYTES: '1024',
      },
      'DOCUMENT_MAX_PROJECT_STORAGE_BYTES must be greater',
    ],
    [
      { NODE_ENV: 'test', DOCUMENT_MAX_PDF_PAGES: '0' },
      'DOCUMENT_MAX_PDF_PAGES must be an integer',
    ],
    [
      {
        NODE_ENV: 'test',
        DOCUMENT_PROCESSING_TIMEOUT_MS: '30000',
        DOCUMENT_PROCESSING_LEASE_MS: '30000',
      },
      'DOCUMENT_PROCESSING_LEASE_MS must be greater',
    ],
    [
      {
        NODE_ENV: 'test',
        DOCUMENT_PROCESSING_TIMEOUT_MS: '10000',
        DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS: '10000',
      },
      'DOCUMENT_MALWARE_SCANNER_TIMEOUT_MS must be less',
    ],
  ])('rejects invalid environment values', (source, message) => {
    expect(() => validateEnvironment(source)).toThrow(message);
  });
});
