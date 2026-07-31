import { Logger } from '@nestjs/common';
import {
  DocumentTelemetry,
  assertPrivacySafeDocumentLog,
  documentCorrelationId,
} from './document.telemetry';

describe('DocumentTelemetry privacy boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['original_filename', 'client-health-record.pdf'],
    ['title', 'Private acquisition plan'],
    ['extracted_text', 'Confidential source content'],
    ['file_contents', Buffer.from('private source')],
  ])('rejects the sensitive %s property', (property, value) => {
    expect(() =>
      assertPrivacySafeDocumentLog({
        event: 'document_upload_finished',
        project_id: 'project-1',
        document_id: 'document-1',
        correlation_id: 'correlation-1',
        format_category: 'pdf',
        size_band: 'under_100_kib',
        duration_ms: 12,
        retry_count: 0,
        outcome: 'accepted',
        error_code: null,
        [property]: value,
      }),
    ).toThrow(/unsafe properties/u);
  });

  it('rejects binary content hidden in an allowlisted property', () => {
    expect(() =>
      assertPrivacySafeDocumentLog({
        event: 'document_upload_finished',
        project_id: 'project-1',
        document_id: Buffer.from('private source'),
        correlation_id: 'correlation-1',
        format_category: 'pdf',
        size_band: 'under_100_kib',
        duration_ms: 12,
        retry_count: 0,
        outcome: 'accepted',
        error_code: null,
      }),
    ).toThrow(/unsafe values/u);
  });

  it('writes an allowlisted structured event without the raw correlation input', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const telemetry = new DocumentTelemetry();
    const correlationId = documentCorrelationId('private-idempotency-value');

    telemetry.record({
      event: 'document_upload_finished',
      project_id: 'project-1',
      document_id: 'document-1',
      correlation_id: correlationId,
      format_category: 'plain_text',
      size_band: 'under_100_kib',
      duration_ms: 8,
      retry_count: 0,
      outcome: 'accepted',
      error_code: null,
    });

    expect(correlationId).toMatch(/^[0-9a-f]{16}$/u);
    expect(correlationId).not.toContain('private-idempotency-value');
    expect(log).toHaveBeenCalledWith({
      event: 'document_upload_finished',
      project_id: 'project-1',
      document_id: 'document-1',
      correlation_id: correlationId,
      format_category: 'plain_text',
      size_band: 'under_100_kib',
      duration_ms: 8,
      retry_count: 0,
      outcome: 'accepted',
      error_code: null,
    });
  });
});
