import {
  assertOpenAiStructuredOutputFormat,
  OpenAiStructuredOutputFormatError,
} from './openai-structured-output';

describe('OpenAI structured output preflight', () => {
  function capturedFormatError(action: () => void) {
    try {
      action();
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAiStructuredOutputFormatError);
      return error as OpenAiStructuredOutputFormatError;
    }

    throw new Error('Expected the structured output format to be rejected.');
  }

  it('accepts a supported strict response format', () => {
    expect(() =>
      assertOpenAiStructuredOutputFormat({
        name: 'supported_format-1',
        description: 'A supported format.',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              items: { type: 'string' },
            },
          },
          required: ['items'],
        },
      }),
    ).not.toThrow();
  });

  it('rejects unsupported keywords nested inside property schemas', () => {
    const error = capturedFormatError(() =>
      assertOpenAiStructuredOutputFormat({
        name: 'invalid_format',
        description: 'An invalid format.',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            items: {
              type: 'array',
              uniqueItems: true,
              items: { type: 'string' },
            },
          },
          required: ['items'],
        },
      }),
    );

    expect(error).toMatchObject({
      code: 'unsupported_schema_keyword',
      keyword: 'uniqueItems',
    });
  });

  it('does not confuse property names with schema keywords', () => {
    expect(() =>
      assertOpenAiStructuredOutputFormat({
        name: 'keyword_property_name',
        description: 'A supported property name.',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { not: { type: 'string' } },
          required: ['not'],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      schema: {
        type: 'object',
        properties: {},
        required: [],
      },
      code: 'object_additional_properties_required',
      keyword: 'additionalProperties',
    },
    {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          required_value: { type: 'string' },
          omitted_value: { type: 'string' },
        },
        required: ['required_value'],
      },
      code: 'object_required_properties',
      keyword: 'required',
    },
  ] as const)(
    'rejects an invalid object schema with $code',
    ({ schema, code, keyword }) => {
      const error = capturedFormatError(() =>
        assertOpenAiStructuredOutputFormat({
          name: 'invalid_object',
          description: 'An invalid object schema.',
          schema,
        }),
      );

      expect(error).toMatchObject({ code, keyword });
    },
  );

  it.each([
    {
      name: 'contains spaces',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
        required: [],
      },
      code: 'invalid_format_name',
    },
    {
      name: 'valid_name',
      schema: { type: 'array' },
      code: 'invalid_root_schema',
    },
  ] as const)('rejects $code', ({ name, schema, code }) => {
    const error = capturedFormatError(() =>
      assertOpenAiStructuredOutputFormat({
        name,
        description: 'Invalid format metadata.',
        schema,
      }),
    );

    expect(error).toMatchObject({ code });
  });
});
