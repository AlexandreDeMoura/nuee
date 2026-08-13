import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  DocumentFormatCategory,
  DocumentProcessingErrorCode,
} from '@nuee/shared-types';

export type DocumentSizeBand =
  'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';

export type DocumentOperationalLogEvent =
  | {
      event: 'document_upload_finished';
      project_id: string;
      document_id: string | null;
      correlation_id: string;
      format_category: DocumentFormatCategory | 'unknown';
      size_band: DocumentSizeBand;
      duration_ms: number;
      retry_count: number;
      outcome: 'accepted' | 'idempotent_replay' | 'failed';
      error_code: string | null;
    }
  | {
      event: 'document_processing_finished';
      project_id: string;
      document_id: string;
      correlation_id: string;
      format_category: DocumentFormatCategory;
      size_band: DocumentSizeBand;
      duration_ms: number;
      retry_count: number;
      outcome: 'ready' | 'retry_scheduled' | 'failed' | 'stale';
      error_code: DocumentProcessingErrorCode | null;
    }
  | {
      event: 'document_processing_retry_finished';
      project_id: string;
      document_id: string;
      correlation_id: string;
      format_category: DocumentFormatCategory;
      size_band: DocumentSizeBand;
      duration_ms: number;
      retry_count: number;
      outcome: 'accepted' | 'failed';
      error_code: string | null;
    }
  | {
      event: 'document_file_cleanup_failed';
      project_id: string;
      /** Server-generated opaque storage key — never a submitted filename. */
      file_reference: string;
      error_code: string;
    };

const allowedKeys = {
  document_upload_finished: [
    'event',
    'project_id',
    'document_id',
    'correlation_id',
    'format_category',
    'size_band',
    'duration_ms',
    'retry_count',
    'outcome',
    'error_code',
  ],
  document_processing_finished: [
    'event',
    'project_id',
    'document_id',
    'correlation_id',
    'format_category',
    'size_band',
    'duration_ms',
    'retry_count',
    'outcome',
    'error_code',
  ],
  document_processing_retry_finished: [
    'event',
    'project_id',
    'document_id',
    'correlation_id',
    'format_category',
    'size_band',
    'duration_ms',
    'retry_count',
    'outcome',
    'error_code',
  ],
  document_file_cleanup_failed: [
    'event',
    'project_id',
    'file_reference',
    'error_code',
  ],
} as const;

export function documentSizeBand(sizeBytes: number): DocumentSizeBand {
  if (sizeBytes < 100 * 1024) return 'under_100_kib';
  if (sizeBytes < 1024 * 1024) return '100_kib_to_1_mib';
  if (sizeBytes <= 10 * 1024 * 1024) return '1_to_10_mib';
  return 'over_10_mib';
}

export function documentCorrelationId(value: unknown): string {
  const input = typeof value === 'string' ? value : 'invalid-correlation';
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Exact allowlist: document content metadata cannot reach ordinary logs. */
export function assertPrivacySafeDocumentLog(event: unknown): void {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Document operational log must be an object.');
  }

  const name: unknown = (event as { event?: unknown }).event;
  if (typeof name !== 'string' || !(name in allowedKeys)) {
    throw new TypeError('Unknown document operational log event.');
  }

  const actual = Object.keys(event).sort();
  const expected = [...allowedKeys[name as keyof typeof allowedKeys]].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Document operational log ${name} has unsafe properties.`,
    );
  }

  for (const value of Object.values(event)) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      !(typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ) {
      throw new TypeError(
        `Document operational log ${name} has unsafe values.`,
      );
    }
  }
}

@Injectable()
export class DocumentTelemetry {
  private readonly logger = new Logger('Documents');

  record(event: DocumentOperationalLogEvent): void {
    assertPrivacySafeDocumentLog(event);
    this.logger.log(event);
  }
}
