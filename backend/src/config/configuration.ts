import { registerAs } from '@nestjs/config';
import type {
  DocumentUploadFormatPolicy,
  DocumentUploadPolicy,
} from '@nuee/shared-types';

export type AppEnvironment = 'development' | 'test' | 'production';
export type AiProvider = 'openai';

export interface AppConfig {
  environment: AppEnvironment;
  port: number;
  frontendOrigin: string;
  databasePath?: string;
}

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  focusedResponseWordBudget: number;
  modelInputTokenLimit: number;
  reservedOutputTokens: number;
  inputSafetyMarginTokens: number;
  requestTimeoutMs: number;
}

export interface DocumentsConfig extends DocumentUploadPolicy {
  privateStoragePath?: string;
  maxPdfPages: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const DEFAULT_AI_MODEL = 'gpt-5.6-sol';
const DEFAULT_FOCUSED_RESPONSE_WORD_BUDGET = 200;
const DEFAULT_MODEL_INPUT_TOKEN_LIMIT = 128_000;
const DEFAULT_RESERVED_OUTPUT_TOKENS = 4_000;
const DEFAULT_INPUT_SAFETY_MARGIN_TOKENS = 8_000;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_DOCUMENTS_PER_PROJECT = 25;
const DEFAULT_MAX_DOCUMENT_PROJECT_STORAGE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_PDF_PAGES = 200;

const SUPPORTED_DOCUMENT_FORMATS: readonly DocumentUploadFormatPolicy[] = [
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
];

type EnvironmentSource = Record<string, unknown>;

function optionalString(
  source: EnvironmentSource,
  key: string,
): string | undefined {
  const value = source[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string when provided.`);
  }

  return value.trim();
}

function enumValue<const T extends readonly string[]>(
  source: EnvironmentSource,
  key: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const value = optionalString(source, key) ?? fallback;

  if (!allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}.`);
  }

  return value;
}

function integerValue(
  source: EnvironmentSource,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = source[key];
  const value =
    rawValue === undefined || rawValue === null || rawValue === ''
      ? fallback
      : Number(rawValue);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function frontendOrigin(source: EnvironmentSource): string {
  const value =
    optionalString(source, 'FRONTEND_URL') ?? DEFAULT_FRONTEND_ORIGIN;

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('FRONTEND_URL must be a valid HTTP or HTTPS origin.');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('FRONTEND_URL must be a valid HTTP or HTTPS origin.');
  }

  return url.origin;
}

export function createAppConfig(source: EnvironmentSource): AppConfig {
  return {
    environment: enumValue(
      source,
      'NODE_ENV',
      ['development', 'test', 'production'] as const,
      'development',
    ),
    port: integerValue(source, 'PORT', DEFAULT_PORT, 1, 65_535),
    frontendOrigin: frontendOrigin(source),
    databasePath: optionalString(source, 'PROJECT_DATABASE_PATH'),
  };
}

export function createAiConfig(source: EnvironmentSource): AiConfig {
  const environment = enumValue(
    source,
    'NODE_ENV',
    ['development', 'test', 'production'] as const,
    'development',
  );
  const provider = enumValue(
    source,
    'AI_PROVIDER',
    ['openai'] as const,
    'openai',
  );
  const apiKey = optionalString(source, 'OPENAI_API_KEY');

  if (environment !== 'test' && !apiKey) {
    throw new Error('OPENAI_API_KEY is required when NODE_ENV is not "test".');
  }

  const config: AiConfig = {
    provider,
    model: optionalString(source, 'AI_MODEL') ?? DEFAULT_AI_MODEL,
    apiKey: apiKey ?? '',
    focusedResponseWordBudget: integerValue(
      source,
      'AI_FOCUSED_RESPONSE_WORD_BUDGET',
      DEFAULT_FOCUSED_RESPONSE_WORD_BUDGET,
      50,
      2_000,
    ),
    modelInputTokenLimit: integerValue(
      source,
      'AI_MODEL_INPUT_TOKEN_LIMIT',
      DEFAULT_MODEL_INPUT_TOKEN_LIMIT,
      1_024,
      2_000_000,
    ),
    reservedOutputTokens: integerValue(
      source,
      'AI_RESERVED_OUTPUT_TOKENS',
      DEFAULT_RESERVED_OUTPUT_TOKENS,
      1,
      200_000,
    ),
    inputSafetyMarginTokens: integerValue(
      source,
      'AI_INPUT_SAFETY_MARGIN_TOKENS',
      DEFAULT_INPUT_SAFETY_MARGIN_TOKENS,
      0,
      200_000,
    ),
    requestTimeoutMs: integerValue(
      source,
      'AI_REQUEST_TIMEOUT_MS',
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
      1_000,
      600_000,
    ),
  };

  if (
    config.reservedOutputTokens + config.inputSafetyMarginTokens >=
    config.modelInputTokenLimit
  ) {
    throw new Error(
      'AI_RESERVED_OUTPUT_TOKENS plus AI_INPUT_SAFETY_MARGIN_TOKENS must be less than AI_MODEL_INPUT_TOKEN_LIMIT.',
    );
  }

  return config;
}

export function createDocumentsConfig(
  source: EnvironmentSource,
): DocumentsConfig {
  const maxFileSizeBytes = integerValue(
    source,
    'DOCUMENT_MAX_FILE_SIZE_BYTES',
    DEFAULT_MAX_DOCUMENT_FILE_SIZE_BYTES,
    1,
    100 * 1024 * 1024,
  );
  const maxDocumentsPerProject = integerValue(
    source,
    'DOCUMENT_MAX_DOCUMENTS_PER_PROJECT',
    DEFAULT_MAX_DOCUMENTS_PER_PROJECT,
    1,
    1_000,
  );
  const maxProjectStorageBytes = integerValue(
    source,
    'DOCUMENT_MAX_PROJECT_STORAGE_BYTES',
    DEFAULT_MAX_DOCUMENT_PROJECT_STORAGE_BYTES,
    1,
    10 * 1024 * 1024 * 1024,
  );

  if (maxProjectStorageBytes < maxFileSizeBytes) {
    throw new Error(
      'DOCUMENT_MAX_PROJECT_STORAGE_BYTES must be greater than or equal to DOCUMENT_MAX_FILE_SIZE_BYTES.',
    );
  }

  return {
    privateStoragePath: optionalString(source, 'DOCUMENT_PRIVATE_STORAGE_PATH'),
    supported_formats: SUPPORTED_DOCUMENT_FORMATS.map((format) => ({
      category: format.category,
      extensions: [...format.extensions],
      mime_types: [...format.mime_types],
    })),
    max_file_size_bytes: maxFileSizeBytes,
    max_files_per_request: 1,
    max_documents_per_project: maxDocumentsPerProject,
    max_project_storage_bytes: maxProjectStorageBytes,
    maxPdfPages: integerValue(
      source,
      'DOCUMENT_MAX_PDF_PAGES',
      DEFAULT_MAX_PDF_PAGES,
      1,
      10_000,
    ),
  };
}

export function validateEnvironment(
  source: EnvironmentSource,
): EnvironmentSource {
  createAppConfig(source);
  createAiConfig(source);
  createDocumentsConfig(source);
  return source;
}

export const appConfig = registerAs('app', () => createAppConfig(process.env));

export const aiConfig = registerAs('ai', () => createAiConfig(process.env));

export const documentsConfig = registerAs('documents', () =>
  createDocumentsConfig(process.env),
);
