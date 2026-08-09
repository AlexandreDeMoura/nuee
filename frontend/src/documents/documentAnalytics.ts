import type { DocumentFormatCategory, DocumentSummary } from '../api';
import {
  trackAnalytics,
  type AnalyticsClient,
  type AnalyticsEventProperties,
} from '../analytics';

export type DocumentAnalyticsEventName = Extract<
  keyof AnalyticsEventProperties,
  `document_${string}`
>;
export type DocumentUploadSource = 'documents_panel' | 'project_creation';
export type DocumentSizeBand =
  'under_100_kib' | '100_kib_to_1_mib' | '1_to_10_mib' | 'over_10_mib';

const allowedKeys = {
  document_upload_finished: [
    'project_id',
    'document_id',
    'upload_source',
    'format_category',
    'size_band',
    'outcome',
    'processing_state',
  ],
  document_upload_retry_requested: [
    'project_id',
    'upload_source',
    'format_category',
    'size_band',
  ],
  document_processing_observed: [
    'project_id',
    'document_id',
    'format_category',
    'size_band',
    'processing_state',
    'processing_duration_ms',
    'error_code',
  ],
  document_processing_retry_finished: [
    'project_id',
    'document_id',
    'format_category',
    'size_band',
    'outcome',
    'processing_state',
  ],
  document_inspected: [
    'project_id',
    'document_id',
    'format_category',
    'size_band',
    'context_readiness',
  ],
} as const satisfies Record<DocumentAnalyticsEventName, readonly string[]>;

export function documentSizeBand(sizeBytes: number): DocumentSizeBand {
  if (sizeBytes < 100 * 1024) return 'under_100_kib';
  if (sizeBytes < 1024 * 1024) return '100_kib_to_1_mib';
  if (sizeBytes <= 10 * 1024 * 1024) return '1_to_10_mib';
  return 'over_10_mib';
}

export function configuredDocumentFormat(
  filename: string,
  formats: readonly {
    category: DocumentFormatCategory;
    extensions: readonly string[];
  }[],
): DocumentFormatCategory | 'unknown' {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot).toLowerCase() : '';

  return (
    formats.find((format) =>
      format.extensions.some(
        (configured) => configured.toLowerCase() === extension,
      ),
    )?.category ?? 'unknown'
  );
}

export function documentProcessingDurationMs(
  document: DocumentSummary,
): number | null {
  if (document.processing_status === 'processing') return null;

  const started = Date.parse(document.created_at);
  const finished = Date.parse(document.updated_at);
  return Number.isFinite(started) && Number.isFinite(finished)
    ? Math.max(0, finished - started)
    : null;
}

/** Runtime allowlist guarding the vendor boundary from document content metadata. */
export function assertPrivacySafeDocumentAnalytics(
  event: DocumentAnalyticsEventName,
  properties: unknown,
): void {
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    throw new TypeError('Document analytics properties must be an object.');
  }

  const actual = Object.keys(properties).sort();
  const expected = [...allowedKeys[event]].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(
      `Document analytics event ${event} has unsafe properties.`,
    );
  }

  for (const value of Object.values(properties)) {
    const safeScalar =
      value === null ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const safeIdentifiers =
      Array.isArray(value) && value.every((item) => typeof item === 'string');

    if (!safeScalar && !safeIdentifiers) {
      throw new TypeError(
        `Document analytics event ${event} has unsafe values.`,
      );
    }
  }
}

export function trackDocumentAnalytics<
  EventName extends DocumentAnalyticsEventName,
>(
  analyticsClient: AnalyticsClient,
  event: EventName,
  properties: AnalyticsEventProperties[EventName],
): void {
  assertPrivacySafeDocumentAnalytics(event, properties);
  trackAnalytics(analyticsClient, event, properties);
}
