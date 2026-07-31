import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsClient } from '../analytics';
import {
  documentSummaryFixture,
  documentUploadPolicyFixture,
} from './documentTestFixtures';
import { useDocumentLibrary } from './useDocumentLibrary';

afterEach(cleanup);

function analyticsFixture() {
  return { track: vi.fn() } as unknown as AnalyticsClient;
}

describe('useDocumentLibrary', () => {
  it('keeps uploads independent and reuses the idempotency key after a transport failure', async () => {
    const projectId = 'project-a';
    const existing = documentSummaryFixture({
      id: 'ready-existing',
      project_id: projectId,
      title: 'Existing source',
    });
    const analyticsClient = analyticsFixture();
    const uploadAttempts = new Map<number, number>();
    const uploadKeys = new Map<number, string[]>();
    const upload = vi.fn(
      async (
        requestProjectId: string,
        input: { file: File; idempotency_key: string },
      ) => {
        const fixtureId = input.file.lastModified;
        const attempt = (uploadAttempts.get(fixtureId) ?? 0) + 1;
        uploadAttempts.set(fixtureId, attempt);
        uploadKeys.set(fixtureId, [
          ...(uploadKeys.get(fixtureId) ?? []),
          input.idempotency_key,
        ]);

        if (fixtureId === 1 && attempt === 1) {
          throw new Error('Connection interrupted after transfer.');
        }

        return documentSummaryFixture({
          id: `uploaded-${fixtureId}`,
          project_id: requestProjectId,
          original_filename: input.file.name,
          processing_status: 'processing',
          title: 'duplicate',
        });
      },
    );
    const requests = {
      list: async () => [existing],
      policy: async () => documentUploadPolicyFixture,
      upload,
    };
    const { result } = renderHook(() =>
      useDocumentLibrary({
        analyticsClient,
        createUploadId: () => 'stable-upload',
        pollIntervalMs: 60_000,
        projectId,
        requests,
      }),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(result.current.policyStatus).toBe('ready');
    });

    let failedTransferId = '';
    act(() => {
      failedTransferId = result.current.uploadFile(
        new File(['first'], 'duplicate.txt', {
          lastModified: 1,
          type: 'text/plain',
        }),
        'project_creation',
      );
      result.current.uploadFile(
        new File(['second'], 'duplicate.txt', {
          lastModified: 2,
          type: 'text/plain',
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.transfers).toEqual([
        expect.objectContaining({
          id: failedTransferId,
          status: 'failed',
          error: 'Connection interrupted after transfer.',
        }),
      ]);
      expect(result.current.documents.map(({ id }) => id).sort()).toEqual([
        'ready-existing',
        'uploaded-2',
      ]);
    });

    act(() => result.current.retryTransfer(failedTransferId));

    await waitFor(() => {
      expect(result.current.transfers).toEqual([]);
      expect(result.current.documents.map(({ id }) => id).sort()).toEqual([
        'ready-existing',
        'uploaded-1',
        'uploaded-2',
      ]);
    });
    expect(uploadKeys.get(1)).toEqual([
      'document-upload:stable-upload:1',
      'document-upload:stable-upload:1',
    ]);
    expect(uploadKeys.get(2)).toEqual(['document-upload:stable-upload:2']);

    const serializedAnalytics = JSON.stringify(
      (analyticsClient.track as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(serializedAnalytics).not.toContain('duplicate.txt');
    expect(serializedAnalytics).not.toContain('first');
    expect(serializedAnalytics).not.toContain('second');
    expect(analyticsClient.track).toHaveBeenCalledWith(
      'document_upload_finished',
      expect.objectContaining({
        upload_source: 'project_creation',
        outcome: 'failed',
      }),
    );
  });

  it('aborts an active upload and discards its state when the project changes', async () => {
    let uploadSignal: AbortSignal | undefined;
    const upload = vi.fn(
      (
        _projectId: string,
        _input: { file: File; idempotency_key: string },
        signal?: AbortSignal,
      ) =>
        new Promise<never>((_resolve, reject) => {
          uploadSignal = signal;
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const list = vi.fn(async (projectId: string) =>
      projectId === 'project-b'
        ? [
            documentSummaryFixture({
              id: 'project-b-document',
              project_id: projectId,
            }),
          ]
        : [],
    );
    const requests = {
      list,
      policy: async () => documentUploadPolicyFixture,
      upload,
    };
    const { rerender, result } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useDocumentLibrary({
          projectId,
          requests,
        }),
      { initialProps: { projectId: 'project-a' } },
    );

    await waitFor(() => expect(result.current.policy).not.toBeNull());
    act(() => {
      result.current.uploadFile(
        new File(['source'], 'source.txt', { type: 'text/plain' }),
      );
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    rerender({ projectId: 'project-b' });

    await waitFor(() => {
      expect(uploadSignal?.aborted).toBe(true);
      expect(result.current.transfers).toEqual([]);
      expect(result.current.documents.map(({ id }) => id)).toEqual([
        'project-b-document',
      ]);
    });
  });

  it('polls processing rows independently and restores the persisted result on reload', async () => {
    const projectId = 'project-a';
    const processing = documentSummaryFixture({
      id: 'processing-document',
      project_id: projectId,
      processing_status: 'processing',
    });
    const ready = documentSummaryFixture({
      id: 'ready-document',
      project_id: projectId,
      title: 'Usable source',
    });
    const failed = documentSummaryFixture({
      ...processing,
      processing_status: 'failed',
      processing_error_code: 'no_text',
      updated_at: '2026-07-30T10:01:00.000Z',
    });
    let listCalls = 0;
    const list = vi.fn(async () => {
      listCalls += 1;
      return listCalls === 1 ? [processing, ready] : [failed, ready];
    });
    const options = {
      pollIntervalMs: 0,
      projectId,
      requests: {
        list,
        policy: async () => documentUploadPolicyFixture,
      },
    };
    const firstRender = renderHook(() => useDocumentLibrary(options));

    await waitFor(() => {
      expect(list).toHaveBeenCalledTimes(2);
      expect(firstRender.result.current.documents).toEqual([failed, ready]);
    });
    firstRender.unmount();

    const reload = renderHook(() => useDocumentLibrary(options));
    await waitFor(() => {
      expect(reload.result.current.status).toBe('ready');
      expect(reload.result.current.documents).toEqual([failed, ready]);
    });
  });
});
