import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import {
  useDocumentMultiSelection,
  type DocumentContextSource,
  type DocumentMultiSelection,
} from '../src/documents';

const projectId = 'project-1';

function documentSource(
  overrides: Partial<DocumentContextSource> = {},
): DocumentContextSource {
  return {
    id: 'document-1',
    processing_status: 'ready',
    project_id: projectId,
    title: 'Launch brief',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('document context selection adapter', () => {
  it('confirms only current ready same-project documents in selection order', () => {
    const onConfirm = vi.fn();
    const multiSelection: DocumentMultiSelection = {
      allowEmptySelection: true,
      initialDocumentIds: [
        'document-1',
        'document-pending',
        'document-foreign',
      ],
      onCancel: vi.fn(),
      onConfirm,
    };
    const readyDocument = documentSource();
    const secondDocument = documentSource({
      id: 'document-2',
      title: 'Customer interviews',
    });
    const pendingDocument = documentSource({
      id: 'document-pending',
      processing_status: 'processing',
      title: 'Market research',
    });
    const foreignDocument = documentSource({
      id: 'document-foreign',
      project_id: 'project-2',
      title: 'Another project',
    });
    const { rerender, result } = renderHook(
      ({
        documents,
      }: {
        documents: readonly DocumentContextSource[];
      }) =>
        useDocumentMultiSelection({
          documents,
          multiSelection,
          projectId,
        }),
      {
        initialProps: {
          documents: [
            readyDocument,
            secondDocument,
            pendingDocument,
            foreignDocument,
          ],
        },
      },
    );

    expect(result.current.documents.map(({ id }) => id)).toEqual([
      readyDocument.id,
      secondDocument.id,
      pendingDocument.id,
    ]);
    expect(result.current.selectedDocumentIds).toEqual([readyDocument.id]);

    act(() => result.current.toggle(pendingDocument.id));
    expect(result.current.selectedDocumentIds).toEqual([readyDocument.id]);

    act(() => result.current.toggle(secondDocument.id));
    expect(result.current.selectedDocumentIds).toEqual([
      readyDocument.id,
      secondDocument.id,
    ]);

    rerender({
      documents: [
        readyDocument,
        {
          ...secondDocument,
          processing_status: 'failed',
        },
        pendingDocument,
        foreignDocument,
      ],
    });

    expect(result.current.selectedDocumentIds).toEqual([readyDocument.id]);
    act(() => result.current.confirm());

    expect(onConfirm).toHaveBeenCalledWith({
      documentIds: [readyDocument.id],
      documents: [readyDocument],
      projectId,
    });
  });

  it('cancels once on Escape without confirming a selection', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    renderHook(() =>
      useDocumentMultiSelection({
        documents: [documentSource()],
        multiSelection: {
          onCancel,
          onConfirm,
        },
        projectId,
      }),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
