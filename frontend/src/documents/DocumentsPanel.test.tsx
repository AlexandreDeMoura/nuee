import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentLibraryController } from './useDocumentLibrary';
import { DocumentsPanel } from './DocumentsPanel';
import {
  documentDetailFixture,
  documentSummaryFixture,
  documentUploadPolicyFixture,
} from './documentTestFixtures';

afterEach(cleanup);

function controllerFixture(
  overrides: Partial<DocumentLibraryController> = {},
): DocumentLibraryController {
  return {
    clearProcessingError: vi.fn(),
    dismissTransfer: vi.fn(),
    documents: [],
    error: null,
    policy: documentUploadPolicyFixture,
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
    uploadFile: vi.fn(() => 'transfer-id'),
    ...overrides,
  };
}

describe('DocumentsPanel', () => {
  it('renders hostile names and processed text inertly while preserving accessible status', async () => {
    const projectId = 'project-a';
    const hostileTitle = '<img src=x onerror=alert(1)>';
    const hostileFilename = '<script>window.hacked=true</script>.txt';
    const hostileText = '<svg onload=alert(1)>Complete source</svg>';
    const ready = documentSummaryFixture({
      id: 'ready-document',
      project_id: projectId,
      title: hostileTitle,
      original_filename: hostileFilename,
    });
    const processing = documentSummaryFixture({
      id: 'processing-document',
      project_id: projectId,
      processing_status: 'processing',
      title: 'Processing source',
    });
    const failed = documentSummaryFixture({
      id: 'failed-document',
      project_id: projectId,
      processing_status: 'failed',
      processing_error_code: 'scanner_unavailable',
      can_retry: true,
      title: 'Failed source',
    });
    const controller = controllerFixture({
      documents: [ready, processing, failed],
      processingErrors: {
        'failed-document': 'The retry service is unavailable.',
      },
      transfers: [
        {
          error: 'Upload interrupted.',
          id: 'failed-transfer',
          original_filename: '<img src=x>.md',
          size_bytes: 42,
          status: 'failed',
        },
      ],
    });
    const requestDocument = vi.fn(async () =>
      documentDetailFixture({
        id: ready.id,
        project_id: ready.project_id,
        title: hostileTitle,
        original_filename: hostileFilename,
        processing_status: 'ready',
        extracted_text: hostileText,
      }),
    );
    const { container } = render(
      <DocumentsPanel
        controller={controller}
        projectId={projectId}
        requestDocument={requestDocument}
      />,
    );

    expect(
      screen.getByLabelText('Choose document files').getAttribute('accept'),
    ).toBe('.txt,.md,.pdf');
    expect(screen.getByLabelText('Project documents')).not.toBeNull();
    expect(screen.getByText(hostileTitle)).not.toBeNull();
    expect(screen.getByText(hostileFilename)).not.toBeNull();
    expect(screen.getByText('Upload interrupted.').getAttribute('role')).toBe(
      'alert',
    );
    expect(
      screen
        .getByRole('button', { name: 'Retry processing' })
        .getAttribute('aria-describedby'),
    ).toBe('document-processing-error-failed-document');
    expect(container.querySelector('script, img')).toBeNull();
    expect(
      container.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain('0 transferring. 1 processing. 1 ready. 2 failed.');

    fireEvent.click(
      screen.getByRole('button', { name: `Inspect document: ${hostileTitle}` }),
    );

    await waitFor(() => expect(requestDocument).toHaveBeenCalled());
    expect(screen.getByText(hostileText)).not.toBeNull();
    expect(
      screen.getByText(/complete processed text Nuée uses/i),
    ).not.toBeNull();
    expect(container.querySelector('script, img, svg[onload]')).toBeNull();
  });

  it('keeps ready documents available when list refresh and sibling uploads fail', () => {
    const controller = controllerFixture({
      documents: [
        documentSummaryFixture({
          id: 'ready-document',
          project_id: 'project-a',
        }),
      ],
      error: 'The latest document list could not be loaded.',
      status: 'error',
      transfers: [
        {
          error: 'Upload failed.',
          id: 'failed-transfer',
          original_filename: 'failed.txt',
          size_bytes: 12,
          status: 'failed',
        },
      ],
    });

    render(<DocumentsPanel controller={controller} projectId="project-a" />);

    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Inspect document: Research notes',
      }).disabled,
    ).toBe(false);
    expect(screen.getByText(/Existing documents remain available/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry document list' }));
    expect(controller.refresh).toHaveBeenCalledTimes(1);
  });
});
