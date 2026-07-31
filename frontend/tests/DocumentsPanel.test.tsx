import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  DocumentDetail,
  DocumentSummary,
  DocumentUploadPolicy,
} from '../src/api';
import {
  DocumentsPanel,
  type DocumentLibraryController,
} from '../src/documents';

const projectId = 'project-documents';

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
      mime_types: ['text/markdown'],
    },
    {
      category: 'pdf',
      extensions: ['.pdf'],
      mime_types: ['application/pdf'],
    },
  ],
};

function readyDocument(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    can_retry: false,
    created_at: '2026-07-31T12:05:06.000Z',
    format: 'pdf',
    id: 'document-ready',
    mime_type: 'application/pdf',
    original_filename: 'launch-brief.pdf',
    processing_error_code: null,
    processing_status: 'ready',
    project_id: projectId,
    size_bytes: 1536,
    title: 'Launch brief',
    updated_at: '2026-07-31T12:05:07.000Z',
    ...overrides,
  } as DocumentSummary;
}

function failedDocument(
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    can_retry: true,
    created_at: '2026-07-30T10:04:03.000Z',
    format: 'plain_text',
    id: 'document-failed',
    mime_type: 'text/plain',
    original_filename: 'launch-brief.txt',
    processing_error_code: 'scanner_unavailable',
    processing_status: 'failed',
    project_id: projectId,
    size_bytes: 842,
    title: 'Launch brief',
    updated_at: '2026-07-30T10:04:04.000Z',
    ...overrides,
  } as DocumentSummary;
}

function libraryController(
  overrides: Partial<DocumentLibraryController> = {},
): DocumentLibraryController {
  return {
    clearProcessingError: vi.fn(),
    dismissTransfer: vi.fn(),
    documents: [],
    error: null,
    policy,
    policyError: null,
    policyStatus: 'ready',
    processingErrors: {},
    refresh: vi.fn(),
    refreshPolicy: vi.fn(),
    retryProcessing: vi.fn(async () => true),
    retryTransfer: vi.fn(),
    retryingDocumentIds: new Set(),
    status: 'ready',
    transfers: [],
    uploadFile: vi.fn(() => 'transfer-1'),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DocumentsPanel', () => {
  it('shows the server policy and dispatches every selected file independently', () => {
    const uploadFile = vi.fn((file: File) => `transfer-${file.name}`);
    const controller = libraryController({ uploadFile });

    render(<DocumentsPanel controller={controller} projectId={projectId} />);

    expect(screen.getByText('TXT, MD, PDF · Up to 10 MiB per file')).toBeTruthy();
    expect(screen.getByText('No documents yet')).toBeTruthy();

    const input = screen.getByLabelText('Choose document files') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('.txt,.md,.pdf');

    const first = new File(['first'], 'first.txt', { type: 'text/plain' });
    const second = new File(['second'], 'second.md', {
      type: 'text/markdown',
    });
    fireEvent.change(input, { target: { files: [first, second] } });

    expect(uploadFile.mock.calls.map(([file]) => file)).toEqual([first, second]);
    expect(input.value).toBe('');
  });

  it('keeps durable rows available beside independent transfer, processing, and list failures', () => {
    const retryProcessing = vi.fn(async () => true);
    const retryTransfer = vi.fn();
    const dismissTransfer = vi.fn();
    const refresh = vi.fn();
    const processing = readyDocument({
      can_retry: false,
      id: 'document-processing',
      original_filename: 'launch-brief.md',
      processing_error_code: null,
      processing_status: 'processing',
      updated_at: '2026-07-31T12:06:00.000Z',
    });
    const failed = failedDocument();
    const controller = libraryController({
      dismissTransfer,
      documents: [readyDocument(), processing, failed],
      error: 'Latest document status could not be loaded.',
      processingErrors: {
        [failed.id]: 'The retry service is unavailable.',
      },
      refresh,
      retryProcessing,
      retryTransfer,
      status: 'error',
      transfers: [
        {
          error: 'The connection was interrupted.',
          id: 'transfer-failed',
          original_filename: 'research.txt',
          size_bytes: 512,
          status: 'failed',
        },
      ],
    });

    render(<DocumentsPanel controller={controller} projectId={projectId} />);

    expect(
      screen.getByText(
        'Latest document status could not be loaded. Existing documents remain available.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Launch brief')).toHaveLength(3);
    expect(screen.getByText('launch-brief.pdf')).toBeTruthy();
    expect(screen.getByText('launch-brief.md')).toBeTruthy();
    expect(screen.getByText('launch-brief.txt')).toBeTruthy();
    expect(screen.getByText('The document safety check is temporarily unavailable.')).toBeTruthy();
    expect(screen.getByText('The retry service is unavailable.')).toBeTruthy();
    expect(document.querySelectorAll('time')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Retry document list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry processing' }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(retryTransfer).toHaveBeenCalledWith('transfer-failed');
    expect(dismissTransfer).toHaveBeenCalledWith('transfer-failed');
    expect(retryProcessing).toHaveBeenCalledWith(failed.id);
  });

  it('inspects ready processed text as escaped content and restores list focus', async () => {
    const sourceDocument = readyDocument({
      original_filename: '<img src=x onerror=alert(1)>.pdf',
      title: '<Launch & safety brief>',
    });
    const detail: DocumentDetail = {
      ...sourceDocument,
      extracted_text: '<script>alert("unsafe")</script>\n\nReadable source text.',
      processing_status: 'ready',
    } as DocumentDetail;
    const requestDocument = vi.fn(async () => detail);

    render(
      <DocumentsPanel
        controller={libraryController({ documents: [sourceDocument] })}
        projectId={projectId}
        requestDocument={requestDocument}
      />,
    );

    const inspect = screen.getByRole('button', {
      name: 'Inspect document: <Launch & safety brief>',
    });
    inspect.focus();
    fireEvent.click(inspect);

    const heading = await screen.findByRole('heading', {
      name: '<Launch & safety brief>',
    });
    expect(document.activeElement).toBe(heading);
    expect(await screen.findByText('PROCESSED TEXT')).toBeTruthy();
    expect(
      screen.getByText(/This is the complete processed text Nuée uses/),
    ).toBeTruthy();
    expect(document.querySelector('pre')?.textContent).toBe(
      '<script>alert("unsafe")</script>\n\nReadable source text.',
    );
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(requestDocument).toHaveBeenCalledWith(
      projectId,
      sourceDocument.id,
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole('button', { name: 'All documents' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', {
          name: 'Inspect document: <Launch & safety brief>',
        }),
      ),
    );
  });

  it('shows non-ready detail without processed text and retries recoverable processing', async () => {
    const sourceDocument = failedDocument();
    const retryProcessing = vi.fn(async () => false);
    const requestDocument = vi.fn(async () => ({
      ...sourceDocument,
      extracted_text: null,
    }) as DocumentDetail);

    render(
      <DocumentsPanel
        controller={libraryController({
          documents: [sourceDocument],
          retryProcessing,
        })}
        projectId={projectId}
        requestDocument={requestDocument}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect document: Launch brief' }),
    );

    expect(await screen.findByText('Processing failed')).toBeTruthy();
    expect(screen.queryByText('PROCESSED TEXT')).toBeNull();
    expect(
      screen.getByText('The document safety check is temporarily unavailable.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry processing' }));

    expect(retryProcessing).toHaveBeenCalledWith(sourceDocument.id);
  });

  it('keeps inspection load failures in-panel and retries the same project-scoped document', async () => {
    const sourceDocument = readyDocument();
    const requestDocument = vi
      .fn()
      .mockRejectedValueOnce(new Error('Document access unavailable.'))
      .mockResolvedValueOnce({
        ...sourceDocument,
        extracted_text: 'Recovered processed text.',
      } as DocumentDetail);

    render(
      <DocumentsPanel
        controller={libraryController({ documents: [sourceDocument] })}
        projectId={projectId}
        requestDocument={requestDocument}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect document: Launch brief' }),
    );

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Couldn’t load this document')).toBeTruthy();
    expect(within(alert).getByText('Document access unavailable.')).toBeTruthy();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Recovered processed text.')).toBeTruthy();
    expect(requestDocument).toHaveBeenCalledTimes(2);
  });
});
