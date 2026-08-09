import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsClient } from '../src/analytics';
import {
  assertPrivacySafeDocumentAnalytics,
  documentSizeBand,
  trackDocumentAnalytics,
} from '../src/documents';

describe('document analytics privacy boundary', () => {
  it.each([
    ['original_filename', 'client-health-record.pdf'],
    ['title', 'Private acquisition plan'],
    ['extracted_text', 'Confidential source content'],
    ['file_contents', new Uint8Array([80, 68, 70])],
  ])('rejects the sensitive %s property', (property, value) => {
    expect(() =>
      assertPrivacySafeDocumentAnalytics('document_inspected', {
        project_id: 'project-1',
        document_id: 'document-1',
        format_category: 'pdf',
        size_band: 'under_100_kib',
        context_readiness: 'ready',
        [property]: value,
      }),
    ).toThrow(/unsafe properties/u);
  });

  it('publishes only the allowlisted typed payload', () => {
    const track = vi.fn<AnalyticsClient['track']>();

    trackDocumentAnalytics({ track }, 'document_upload_finished', {
      project_id: 'project-1',
      document_id: 'document-1',
      upload_source: 'project_creation',
      format_category: 'plain_text',
      size_band: documentSizeBand(42),
      outcome: 'accepted',
      processing_state: 'processing',
    });

    expect(track).toHaveBeenCalledWith('document_upload_finished', {
      project_id: 'project-1',
      document_id: 'document-1',
      upload_source: 'project_creation',
      format_category: 'plain_text',
      size_band: 'under_100_kib',
      outcome: 'accepted',
      processing_state: 'processing',
    });
  });
});
