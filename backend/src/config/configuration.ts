import { registerAs } from '@nestjs/config';

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
  requestTimeoutMs: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const DEFAULT_AI_MODEL = 'gpt-5.6-sol';
const DEFAULT_FOCUSED_RESPONSE_WORD_BUDGET = 200;
const DEFAULT_AI_REQUEST_TIMEOUT_MS = 60_000;

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

  return {
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
    requestTimeoutMs: integerValue(
      source,
      'AI_REQUEST_TIMEOUT_MS',
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
      1_000,
      600_000,
    ),
  };
}

export function validateEnvironment(
  source: EnvironmentSource,
): EnvironmentSource {
  createAppConfig(source);
  createAiConfig(source);
  return source;
}

export const appConfig = registerAs('app', () => createAppConfig(process.env));

export const aiConfig = registerAs('ai', () => createAiConfig(process.env));
