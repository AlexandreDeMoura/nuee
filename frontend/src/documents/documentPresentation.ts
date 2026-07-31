import type {
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
  DocumentUploadPolicy,
} from '../api';

const processingFailureMessages: Record<
  DocumentProcessingErrorCode,
  string
> = {
  unsafe: 'This file did not pass the document safety check.',
  encrypted: 'This document is encrypted or password-protected.',
  corrupted: 'This document is corrupted or could not be read.',
  no_text: 'No usable text could be extracted from this document.',
  too_complex: 'This document is too complex to process within the current limits.',
  storage_unavailable: 'The stored document is temporarily unavailable.',
  scanner_unavailable: 'The document safety check is temporarily unavailable.',
  processing_unavailable: 'Document processing is temporarily unavailable.',
  unknown: 'This document could not be processed.',
};

export const documentStatusLabels: Record<
  DocumentProcessingStatus,
  string
> = {
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export function documentProcessingFailureMessage(
  code: DocumentProcessingErrorCode,
): string {
  return processingFailureMessages[code];
}

export function formatDocumentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  }

  if (bytes < 1024 * 1024) {
    return `${Number((bytes / 1024).toFixed(1))} KiB`;
  }

  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

export function formatDocumentUploadTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(timestamp));
}

export function documentPolicyExtensions(
  policy: DocumentUploadPolicy,
): string[] {
  return [
    ...new Set(
      policy.supported_formats.flatMap(({ extensions }) =>
        extensions.map((extension) => extension.toLowerCase()),
      ),
    ),
  ];
}

export function documentPolicyDescription(
  policy: DocumentUploadPolicy,
): string {
  const formats = documentPolicyExtensions(policy)
    .map((extension) => extension.slice(1).toUpperCase())
    .join(', ');

  return `${formats} · Up to ${formatDocumentSize(policy.max_file_size_bytes)} per file`;
}
