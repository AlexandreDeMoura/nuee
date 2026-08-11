import type { StructuredOutputFormat } from './model-client';

const FORMAT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  'allOf',
  'dependentRequired',
  'dependentSchemas',
  'else',
  'if',
  'not',
  'oneOf',
  'then',
  'uniqueItems',
]);

export type OpenAiStructuredOutputFormatErrorCode =
  | 'invalid_format_name'
  | 'invalid_root_schema'
  | 'object_additional_properties_required'
  | 'object_required_properties'
  | 'unsupported_schema_keyword';

export class OpenAiStructuredOutputFormatError extends Error {
  constructor(
    readonly code: OpenAiStructuredOutputFormatErrorCode,
    readonly keyword: string | null = null,
  ) {
    super('The structured output format is incompatible with OpenAI.');
    this.name = 'OpenAiStructuredOutputFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaFormatError(
  schema: Record<string, unknown>,
): OpenAiStructuredOutputFormatError | null {
  for (const keyword of Object.keys(schema)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      return new OpenAiStructuredOutputFormatError(
        'unsupported_schema_keyword',
        keyword,
      );
    }
  }

  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) {
      return new OpenAiStructuredOutputFormatError(
        'object_additional_properties_required',
        'additionalProperties',
      );
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};
    const propertyNames = Object.keys(properties);
    const required = Array.isArray(schema.required) ? schema.required : [];
    const requiredNames = required.filter(
      (value): value is string => typeof value === 'string',
    );

    if (
      requiredNames.length !== propertyNames.length ||
      propertyNames.some((name) => !requiredNames.includes(name))
    ) {
      return new OpenAiStructuredOutputFormatError(
        'object_required_properties',
        'required',
      );
    }
  }

  for (const mapKeyword of ['properties', '$defs', 'definitions'] as const) {
    const childMap = schema[mapKeyword];

    if (!isRecord(childMap)) {
      continue;
    }

    for (const childSchema of Object.values(childMap)) {
      if (isRecord(childSchema)) {
        const error = schemaFormatError(childSchema);
        if (error) return error;
      }
    }
  }

  for (const childKeyword of ['items', 'additionalProperties'] as const) {
    const childSchema = schema[childKeyword];

    if (isRecord(childSchema)) {
      const error = schemaFormatError(childSchema);
      if (error) return error;
    }
  }

  const alternatives = schema.anyOf;
  if (Array.isArray(alternatives)) {
    for (const childSchema of alternatives) {
      if (isRecord(childSchema)) {
        const error = schemaFormatError(childSchema);
        if (error) return error;
      }
    }
  }

  return null;
}

export function assertOpenAiStructuredOutputFormat(
  format: StructuredOutputFormat,
): void {
  if (!FORMAT_NAME_PATTERN.test(format.name)) {
    throw new OpenAiStructuredOutputFormatError('invalid_format_name');
  }

  if (format.schema.type !== 'object') {
    throw new OpenAiStructuredOutputFormatError('invalid_root_schema');
  }

  const error = schemaFormatError(format.schema);
  if (error) throw error;
}
