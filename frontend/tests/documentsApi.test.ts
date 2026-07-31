import type {
  DocumentDetail,
  DocumentSummary,
  DocumentUploadPolicy,
} from '@nuee/shared-types';
import { describe, expect, it } from 'vitest';
import {
  createDocumentsApi,
  isDocumentDetailResponse,
  isDocumentListResponse,
  isDocumentSummaryResponse,
  isDocumentUploadPolicyResponse,
  type DocumentsRequest,
} from '../src/api/documents';

interface RecordedRequest {
  init?: RequestInit;
  path: string;
}

function createRequestFake(responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: DocumentsRequest = <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    requests.push({ init, path });
    return Promise.resolve(responses.shift() as T);
  };

  return { request, requests };
}

const policy: DocumentUploadPolicy = {
  max_documents_per_project: 25,
  max_file_size_bytes: 10 * 1024 * 1024,
  max_files_per_request: 1,
  max_project_storage_bytes: 100 * 1024 * 1024,
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
    {
      category: 'pdf',
      extensions: ['.pdf'],
      mime_types: ['application/pdf'],
    },
  ],
};

function documentSummary(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    can_retry: false,
    created_at: '2026-07-31T08:00:00.000Z',
    format: 'plain_text',
    id: 'document/1',
    mime_type: 'text/plain',
    original_filename: 'research notes.txt',
    processing_error_code: null,
    processing_status: 'processing',
    project_id: 'project/1',
    size_bytes: 128,
    title: 'research notes',
    updated_at: '2026-07-31T08:00:00.000Z',
    ...overrides,
  } as DocumentSummary;
}

describe('documents API', () => {
  it('requests policy, list, detail, upload, and retry resources', async () => {
    const summary = documentSummary();
    const detail: DocumentDetail = {
      ...summary,
      extracted_text: null,
    };
    const retried = documentSummary({
      updated_at: '2026-07-31T08:01:00.000Z',
    });
    const { request, requests } = createRequestFake([
      policy,
      [summary],
      detail,
      summary,
      retried,
    ]);
    const api = createDocumentsApi(request);
    const signal = new AbortController().signal;
    const file = new File(['Source text'], 'research notes.txt', {
      type: 'text/plain',
    });

    await expect(api.getDocumentUploadPolicy(signal)).resolves.toEqual(policy);
    await expect(
      api.getProjectDocuments('project/1', signal),
    ).resolves.toEqual([summary]);
    await expect(
      api.getDocument('project/1', 'document/1', signal),
    ).resolves.toEqual(detail);
    await expect(
      api.uploadDocument(
        'project/1',
        { file, idempotency_key: 'upload/1' },
        signal,
      ),
    ).resolves.toEqual(summary);
    await expect(
      api.retryDocumentProcessing('project/1', 'document/1', signal),
    ).resolves.toEqual(retried);

    expect(requests.slice(0, 3)).toEqual([
      { init: { signal }, path: '/document-upload-policy' },
      { init: { signal }, path: '/projects/project%2F1/documents' },
      {
        init: { signal },
        path: '/projects/project%2F1/documents/document%2F1',
      },
    ]);
    expect(requests[3]?.path).toBe('/projects/project%2F1/documents');
    expect(requests[3]?.init).toEqual(
      expect.objectContaining({ method: 'POST', signal }),
    );
    const uploadBody = requests[3]?.init?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get('idempotency_key')).toBe('upload/1');
    expect((uploadBody as FormData).get('file')).toEqual(
      expect.objectContaining({
        name: file.name,
        size: file.size,
        type: file.type,
      }),
    );
    expect(requests[4]).toEqual({
      init: { method: 'POST', signal },
      path: '/projects/project%2F1/documents/document%2F1/retry',
    });
  });

  it('validates upload policy limits, formats, and unique values', () => {
    expect(isDocumentUploadPolicyResponse(policy)).toBe(true);

    expect(
      isDocumentUploadPolicyResponse({
        ...policy,
        supported_formats: [
          policy.supported_formats[0],
          policy.supported_formats[0],
        ],
      }),
    ).toBe(false);
    expect(
      isDocumentUploadPolicyResponse({
        ...policy,
        max_file_size_bytes: 0,
      }),
    ).toBe(false);
    expect(
      isDocumentUploadPolicyResponse({
        ...policy,
        max_project_storage_bytes: policy.max_file_size_bytes - 1,
      }),
    ).toBe(false);
    expect(
      isDocumentUploadPolicyResponse({
        ...policy,
        supported_formats: [
          {
            category: 'plain_text',
            extensions: ['txt'],
            mime_types: ['text/plain'],
          },
        ],
      }),
    ).toBe(false);
  });

  it('validates status-specific summary and detail fields', () => {
    const processing = documentSummary();
    const ready = documentSummary({
      processing_status: 'ready',
      updated_at: '2026-07-31T08:01:00.000Z',
    });
    const failed = documentSummary({
      can_retry: true,
      processing_error_code: 'scanner_unavailable',
      processing_status: 'failed',
      updated_at: '2026-07-31T08:01:00.000Z',
    });

    expect(isDocumentSummaryResponse(processing, 'project/1')).toBe(true);
    expect(isDocumentSummaryResponse(ready, 'project/1')).toBe(true);
    expect(isDocumentSummaryResponse(failed, 'project/1')).toBe(true);
    expect(
      isDocumentSummaryResponse(
        { ...processing, project_id: 'another-project' },
        'project/1',
      ),
    ).toBe(false);
    expect(
      isDocumentSummaryResponse(
        { ...processing, processing_error_code: 'unknown' },
        'project/1',
      ),
    ).toBe(false);
    expect(
      isDocumentSummaryResponse(
        { ...failed, processing_error_code: 'stack_trace' },
        'project/1',
      ),
    ).toBe(false);
    expect(
      isDocumentSummaryResponse(
        { ...ready, can_retry: true },
        'project/1',
      ),
    ).toBe(false);

    expect(
      isDocumentDetailResponse(
        { ...ready, extracted_text: 'Complete processed text.' },
        'project/1',
        'document/1',
      ),
    ).toBe(true);
    expect(
      isDocumentDetailResponse(
        { ...ready, extracted_text: ' ' },
        'project/1',
        'document/1',
      ),
    ).toBe(false);
    expect(
      isDocumentDetailResponse(
        { ...processing, extracted_text: 'Partial text' },
        'project/1',
        'document/1',
      ),
    ).toBe(false);
  });

  it('rejects duplicate or cross-project list records', () => {
    const summary = documentSummary();

    expect(isDocumentListResponse([summary], 'project/1')).toBe(true);
    expect(isDocumentListResponse([summary, summary], 'project/1')).toBe(false);
    expect(
      isDocumentListResponse(
        [summary, documentSummary({ id: 'document/2', project_id: 'project/2' })],
        'project/1',
      ),
    ).toBe(false);
  });
});
