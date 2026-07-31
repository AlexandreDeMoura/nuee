import { act } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type {
  DocumentSummary,
  DocumentUploadPolicy,
} from '@nuee/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentLibrary } from '../src/documents';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
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
  ],
};

function documentSummary(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    can_retry: false,
    created_at: '2026-07-31T08:00:00.000Z',
    format: 'plain_text',
    id: 'document-1',
    mime_type: 'text/plain',
    original_filename: 'source.txt',
    processing_error_code: null,
    processing_status: 'ready',
    project_id: 'project-1',
    size_bytes: 128,
    title: 'source',
    updated_at: '2026-07-31T08:01:00.000Z',
    ...overrides,
  } as DocumentSummary;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useDocumentLibrary', () => {
  it('loads policy and a project-scoped collection with explicit states', async () => {
    const list = vi.fn(async () => [documentSummary()]);
    const policyRequest = vi.fn(async () => policy);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        projectId: 'project-1',
        requests: { list, policy: policyRequest },
      }),
    );

    expect(result.current.status).toBe('loading');
    expect(result.current.policyStatus).toBe('loading');

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(result.current.policyStatus).toBe('ready'));

    expect(result.current.documents).toEqual([documentSummary()]);
    expect(result.current.policy).toEqual(policy);
    expect(list).toHaveBeenCalledWith(
      'project-1',
      expect.any(AbortSignal),
    );
    expect(policyRequest).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('aborts obsolete loads and ignores stale records after project changes', async () => {
    const first = deferred<DocumentSummary[]>();
    const second = deferred<DocumentSummary[]>();
    const list = vi.fn((projectId: string) =>
      projectId === 'project-1' ? first.promise : second.promise,
    );
    const policyRequest = vi.fn(async () => policy);
    const { rerender, result } = renderHook(
      ({ projectId }) =>
        useDocumentLibrary({
          projectId,
          requests: { list, policy: policyRequest },
        }),
      { initialProps: { projectId: 'project-1' } },
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    const firstSignal = list.mock.calls[0]?.[1] as AbortSignal | undefined;
    rerender({ projectId: 'project-2' });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    const secondProjectDocument = documentSummary({
      id: 'document-2',
      project_id: 'project-2',
    });
    await act(async () => second.resolve([secondProjectDocument]));
    expect(result.current.documents).toEqual([secondProjectDocument]);

    await act(async () =>
      first.resolve([
        documentSummary({ title: 'Stale first-project document' }),
      ]),
    );
    expect(result.current.documents).toEqual([secondProjectDocument]);
  });

  it('keeps a local failed transfer and reuses its idempotency key on retry', async () => {
    const uploaded = documentSummary({ processing_status: 'processing' });
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection interrupted.'))
      .mockResolvedValueOnce(uploaded);
    const list = vi.fn(async () => []);
    const policyRequest = vi.fn(async () => policy);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        createUploadId: () => 'stable-upload',
        projectId: 'project-1',
        requests: {
          list,
          policy: policyRequest,
          upload,
        },
      }),
    );

    await waitFor(() => expect(result.current.policyStatus).toBe('ready'));

    let transferId = '';
    act(() => {
      transferId = result.current.uploadFile(
        new File(['Source text'], 'source.txt', { type: 'text/plain' }),
      );
    });
    expect(result.current.transfers).toEqual([
      expect.objectContaining({
        id: transferId,
        original_filename: 'source.txt',
        status: 'transferring',
      }),
    ]);

    await waitFor(() =>
      expect(result.current.transfers[0]).toEqual(
        expect.objectContaining({
          error: 'Connection interrupted.',
          status: 'failed',
        }),
      ),
    );

    act(() => result.current.retryTransfer(transferId));
    await waitFor(() => expect(result.current.transfers).toEqual([]));
    expect(result.current.documents).toEqual([uploaded]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0]?.[1].idempotency_key).toBe(
      upload.mock.calls[1]?.[1].idempotency_key,
    );
    expect(upload.mock.calls[0]?.[1].file).toBe(
      upload.mock.calls[1]?.[1].file,
    );
  });

  it('reports client preflight failures without contacting the server', async () => {
    const upload = vi.fn();
    const list = vi.fn(async () => []);
    const policyRequest = vi.fn(async () => policy);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        createUploadId: () => 'invalid-upload',
        projectId: 'project-1',
        requests: {
          list,
          policy: policyRequest,
          upload,
        },
      }),
    );

    await waitFor(() => expect(result.current.policyStatus).toBe('ready'));
    act(() => {
      result.current.uploadFile(
        new File(['Unsupported'], 'source.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      );
    });

    await waitFor(() =>
      expect(result.current.transfers[0]).toEqual(
        expect.objectContaining({
          error: expect.stringContaining('supported document type'),
          status: 'failed',
        }),
      ),
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it('preserves an upload completed during a stale list request', async () => {
    const pendingList = deferred<DocumentSummary[]>();
    const uploaded = documentSummary({ processing_status: 'processing' });
    const list = vi.fn(() => pendingList.promise);
    const policyRequest = vi.fn(async () => policy);
    const upload = vi.fn(async () => uploaded);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        createUploadId: () => 'during-list',
        projectId: 'project-1',
        requests: {
          list,
          policy: policyRequest,
          upload,
        },
      }),
    );

    await waitFor(() => expect(result.current.policyStatus).toBe('ready'));
    act(() => {
      result.current.uploadFile(
        new File(['Source'], 'source.txt', { type: 'text/plain' }),
      );
    });
    await waitFor(() => expect(result.current.documents).toEqual([uploaded]));

    await act(async () => pendingList.resolve([]));
    expect(result.current.status).toBe('ready');
    expect(result.current.documents).toEqual([uploaded]);
  });

  it('aborts an upload and discards its stale result after leaving the project', async () => {
    const pendingUpload = deferred<DocumentSummary>();
    let uploadSignal: AbortSignal | undefined;
    const upload = vi.fn(
      (
        projectId: string,
        input: unknown,
        signal?: AbortSignal,
      ) => {
        void projectId;
        void input;
        uploadSignal = signal;
        return pendingUpload.promise;
      },
    );
    const list = vi.fn(async () => []);
    const policyRequest = vi.fn(async () => policy);
    const { rerender, result } = renderHook(
      ({ projectId }) =>
        useDocumentLibrary({
          createUploadId: () => 'stale-upload',
          projectId,
          requests: { list, policy: policyRequest, upload },
        }),
      { initialProps: { projectId: 'project-1' } },
    );

    await waitFor(() => expect(result.current.policyStatus).toBe('ready'));
    act(() => {
      result.current.uploadFile(
        new File(['Source'], 'source.txt', { type: 'text/plain' }),
      );
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    rerender({ projectId: 'project-2' });
    await waitFor(() => expect(uploadSignal?.aborted).toBe(true));
    await act(async () =>
      pendingUpload.resolve(
        documentSummary({ title: 'Stale uploaded document' }),
      ),
    );

    expect(result.current.transfers).toEqual([]);
    expect(result.current.documents).toEqual([]);
  });

  it('keeps ready documents available across a retryable list failure', async () => {
    const ready = documentSummary();
    const list = vi
      .fn()
      .mockResolvedValueOnce([ready])
      .mockRejectedValueOnce(new Error('Refresh unavailable.'))
      .mockResolvedValueOnce([ready]);
    const policyRequest = vi.fn(async () => policy);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        projectId: 'project-1',
        requests: { list, policy: policyRequest },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Refresh unavailable.');
    expect(result.current.documents).toEqual([ready]);

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.documents).toEqual([ready]);
  });

  it('polls only while a processing item exists and merges its result per item', async () => {
    const ready = documentSummary({ id: 'ready-document' });
    const failed = documentSummary({
      can_retry: true,
      id: 'retry-document',
      processing_error_code: 'scanner_unavailable',
      processing_status: 'failed',
    });
    const processing = documentSummary({
      id: failed.id,
      processing_status: 'processing',
      updated_at: '2026-07-31T08:02:00.000Z',
    });
    const completed = documentSummary({
      id: failed.id,
      processing_status: 'ready',
      updated_at: '2026-07-31T08:03:00.000Z',
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([ready, failed])
      .mockResolvedValueOnce([ready, completed]);
    const retryProcessing = vi.fn(async () => processing);
    const policyRequest = vi.fn(async () => policy);
    const { result } = renderHook(() =>
      useDocumentLibrary({
        pollIntervalMs: 5,
        projectId: 'project-1',
        requests: {
          list,
          policy: policyRequest,
          retryProcessing,
        },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await new Promise((resolve) => window.setTimeout(resolve, 15));
    expect(list).toHaveBeenCalledTimes(1);

    let retried = false;
    await act(async () => {
      retried = await result.current.retryProcessing(failed.id);
    });
    expect(retried).toBe(true);
    expect(result.current.documents).toEqual(
      expect.arrayContaining([ready, processing]),
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.documents).toEqual(
        expect.arrayContaining([ready, completed]),
      ),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 15));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps ready records available when another item retry fails', async () => {
    const ready = documentSummary({ id: 'ready-document' });
    const failed = documentSummary({
      can_retry: true,
      id: 'failed-document',
      processing_error_code: 'processing_unavailable',
      processing_status: 'failed',
    });
    const list = vi.fn(async () => [ready, failed]);
    const policyRequest = vi.fn(async () => policy);
    const retryProcessing = vi.fn(async () => {
      throw new Error('Processing remains unavailable.');
    });
    const { result } = renderHook(() =>
      useDocumentLibrary({
        projectId: 'project-1',
        requests: {
          list,
          policy: policyRequest,
          retryProcessing,
        },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.retryProcessing(failed.id);
    });

    expect(result.current.documents).toEqual(
      expect.arrayContaining([ready, failed]),
    );
    expect(result.current.processingErrors[failed.id]).toBe(
      'Processing remains unavailable.',
    );
  });
});
