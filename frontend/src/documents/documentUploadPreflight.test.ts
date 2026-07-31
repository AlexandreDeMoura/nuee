import { describe, expect, it } from 'vitest';
import { documentUploadPolicyFixture } from './documentTestFixtures';
import { preflightDocumentUpload } from './documentUploadPreflight';

describe('preflightDocumentUpload', () => {
  it.each([
    ['notes.txt', 'text/plain', 'plain_text'],
    ['notes.md', 'text/markdown', 'markdown'],
    ['report.pdf', 'application/pdf', 'pdf'],
  ] as const)('accepts a visible %s fixture', async (name, type, format) => {
    const result = await preflightDocumentUpload(
      new File(['source'], name, { type }),
      documentUploadPolicyFixture,
    );

    expect(result).toEqual({ format, ok: true });
  });

  it.each([
    {
      file: new File([], 'empty.txt', { type: 'text/plain' }),
      code: 'empty_file',
    },
    {
      file: new File(['x'], 'unsupported.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      code: 'unsupported_extension',
    },
    {
      file: new File(['%PDF'], 'disguised.txt', { type: 'application/pdf' }),
      code: 'unsupported_mime_type',
    },
  ])('rejects browser-visible input as $code', async ({ file, code }) => {
    await expect(
      preflightDocumentUpload(file, documentUploadPolicyFixture),
    ).resolves.toMatchObject({ ok: false, error: { code } });
  });

  it('reports the configured size limit before reading the file', async () => {
    const policy = {
      ...documentUploadPolicyFixture,
      max_file_size_bytes: 3,
    };

    await expect(
      preflightDocumentUpload(
        new File(['four'], 'large.txt', { type: 'text/plain' }),
        policy,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'file_too_large',
        message: 'Choose a document no larger than 3 bytes.',
      },
    });
  });

  it('rejects a file that becomes unreadable during preflight', async () => {
    const file = new File(['source'], 'unreadable.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'slice', {
      value: () => ({
        arrayBuffer: () => Promise.reject(new Error('device unavailable')),
      }),
    });

    await expect(
      preflightDocumentUpload(file, documentUploadPolicyFixture),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'unreadable_file' },
    });
  });
});
