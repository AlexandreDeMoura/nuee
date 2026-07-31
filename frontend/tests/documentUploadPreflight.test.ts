import type { DocumentUploadPolicy } from '@nuee/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { preflightDocumentUpload } from '../src/documents';

const policy: DocumentUploadPolicy = {
  max_documents_per_project: 25,
  max_file_size_bytes: 10,
  max_files_per_request: 1,
  max_project_storage_bytes: 100,
  supported_formats: [
    {
      category: 'plain_text',
      extensions: ['.txt'],
      mime_types: ['text/plain'],
    },
    {
      category: 'markdown',
      extensions: ['.md'],
      mime_types: ['text/markdown', 'text/plain'],
    },
  ],
};

describe('document upload preflight', () => {
  it('accepts configured extension and visible MIME pairs', async () => {
    const result = await preflightDocumentUpload(
      new File(['notes'], 'NOTES.MD', { type: 'text/markdown' }),
      policy,
    );

    expect(result).toEqual({ format: 'markdown', ok: true });
  });

  it.each([
    [
      new File([], 'empty.txt', { type: 'text/plain' }),
      'empty_file',
    ],
    [
      new File(['content over limit'], 'large.txt', {
        type: 'text/plain',
      }),
      'file_too_large',
    ],
    [
      new File(['notes'], 'notes.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      'unsupported_extension',
    ],
    [
      new File(['notes'], 'notes.txt', { type: 'application/pdf' }),
      'unsupported_mime_type',
    ],
  ])('rejects invalid visible file properties', async (file, code) => {
    const result = await preflightDocumentUpload(file, policy);

    expect(result).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code }),
        ok: false,
      }),
    );
  });

  it('allows an omitted browser MIME and reports unreadable files', async () => {
    await expect(
      preflightDocumentUpload(new File(['notes'], 'notes.txt'), policy),
    ).resolves.toEqual({ format: 'plain_text', ok: true });

    const unreadable = new File(['notes'], 'notes.txt', {
      type: 'text/plain',
    });
    vi.spyOn(unreadable, 'slice').mockReturnValue({
      arrayBuffer: () => Promise.reject(new Error('Device read failed')),
    } as Blob);

    await expect(
      preflightDocumentUpload(unreadable, policy),
    ).resolves.toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'unreadable_file' }),
        ok: false,
      }),
    );
  });
});
