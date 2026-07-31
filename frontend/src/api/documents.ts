import type {
  DocumentDetail,
  DocumentFormatCategory,
  DocumentListResponse,
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
  DocumentSummary,
  DocumentUploadFormatPolicy,
  DocumentUploadPolicy,
  DocumentUploadPolicyResponse,
  RetryDocumentProcessingResponse,
  UploadDocumentResponse,
} from '@nuee/shared-types';
import { requestJson } from './client';

export type {
  DocumentDetail,
  DocumentFormatCategory,
  DocumentListResponse,
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
  DocumentSummary,
  DocumentUploadFormatPolicy,
  DocumentUploadPolicy,
  DocumentUploadPolicyResponse,
  RetryDocumentProcessingResponse,
  UploadDocumentResponse,
};

export interface UploadDocumentInput {
  file: File;
  idempotency_key: string;
}

export type DocumentsRequest = typeof requestJson;

const INVALID_POLICY_MESSAGE =
  'The document upload policy response contained invalid data.';
const INVALID_LIST_MESSAGE =
  'The document list response contained invalid data.';
const INVALID_DOCUMENT_MESSAGE =
  'The document response contained invalid data.';

const DOCUMENT_FORMATS = new Set<DocumentFormatCategory>([
  'plain_text',
  'markdown',
  'pdf',
]);
const DOCUMENT_ERROR_CODES = new Set<DocumentProcessingErrorCode>([
  'unsafe',
  'encrypted',
  'corrupted',
  'no_text',
  'too_complex',
  'storage_unavailable',
  'scanner_unavailable',
  'processing_unavailable',
  'unknown',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isUniqueStringList(
  value: unknown,
  predicate: (entry: string) => boolean = () => true,
): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }

  const normalized = value.flatMap((entry) =>
    isNonEmptyString(entry) ? [entry.trim().toLowerCase()] : [],
  );

  return (
    normalized.length === value.length &&
    normalized.every(predicate) &&
    new Set(normalized).size === normalized.length
  );
}

function isFormatPolicy(value: unknown): value is DocumentUploadFormatPolicy {
  if (
    !isRecord(value) ||
    !DOCUMENT_FORMATS.has(value.category as DocumentFormatCategory)
  ) {
    return false;
  }

  return (
    isUniqueStringList(value.extensions, (extension) =>
      /^\.[a-z0-9]+$/.test(extension),
    ) &&
    value.extensions.length > 0 &&
    isUniqueStringList(value.mime_types, (mimeType) =>
      /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType),
    ) &&
    value.mime_types.length > 0
  );
}

export function isDocumentUploadPolicyResponse(
  value: unknown,
): value is DocumentUploadPolicyResponse {
  if (!isRecord(value) || !Array.isArray(value.supported_formats)) {
    return false;
  }

  const formats = value.supported_formats;

  return (
    formats.length > 0 &&
    formats.every(isFormatPolicy) &&
    new Set(formats.map(({ category }) => category)).size === formats.length &&
    isPositiveInteger(value.max_file_size_bytes) &&
    isPositiveInteger(value.max_files_per_request) &&
    isPositiveInteger(value.max_documents_per_project) &&
    isPositiveInteger(value.max_project_storage_bytes) &&
    value.max_project_storage_bytes >= value.max_file_size_bytes
  );
}

export function assertDocumentUploadPolicyResponse(
  value: unknown,
): DocumentUploadPolicyResponse {
  if (!isDocumentUploadPolicyResponse(value)) {
    throw new Error(INVALID_POLICY_MESSAGE);
  }

  return value;
}

function hasDocumentSummaryBase(
  value: Record<string, unknown>,
  projectId: string,
): boolean {
  return (
    isNonEmptyString(value.id) &&
    value.project_id === projectId &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.original_filename) &&
    DOCUMENT_FORMATS.has(value.format as DocumentFormatCategory) &&
    isNonEmptyString(value.mime_type) &&
    isPositiveInteger(value.size_bytes) &&
    isIsoTimestamp(value.created_at) &&
    isIsoTimestamp(value.updated_at) &&
    Date.parse(value.updated_at) >= Date.parse(value.created_at)
  );
}

export function isDocumentSummaryResponse(
  value: unknown,
  projectId: string,
  documentId?: string,
): value is DocumentSummary {
  if (
    !isRecord(value) ||
    !hasDocumentSummaryBase(value, projectId) ||
    (documentId !== undefined && value.id !== documentId)
  ) {
    return false;
  }

  if (value.processing_status === 'failed') {
    return (
      DOCUMENT_ERROR_CODES.has(
        value.processing_error_code as DocumentProcessingErrorCode,
      ) && typeof value.can_retry === 'boolean'
    );
  }

  return (
    (value.processing_status === 'processing' ||
      value.processing_status === 'ready') &&
    value.processing_error_code === null &&
    value.can_retry === false
  );
}

export function assertDocumentSummaryResponse(
  value: unknown,
  projectId: string,
  documentId?: string,
): DocumentSummary {
  if (!isDocumentSummaryResponse(value, projectId, documentId)) {
    throw new Error(INVALID_DOCUMENT_MESSAGE);
  }

  return value;
}

export function isDocumentListResponse(
  value: unknown,
  projectId: string,
): value is DocumentListResponse {
  return (
    Array.isArray(value) &&
    value.every((document) => isDocumentSummaryResponse(document, projectId)) &&
    new Set(value.map((document) => document.id)).size === value.length
  );
}

export function assertDocumentListResponse(
  value: unknown,
  projectId: string,
): DocumentListResponse {
  if (!isDocumentListResponse(value, projectId)) {
    throw new Error(INVALID_LIST_MESSAGE);
  }

  return value;
}

export function isDocumentDetailResponse(
  value: unknown,
  projectId: string,
  documentId: string,
): value is DocumentDetail {
  if (!isDocumentSummaryResponse(value, projectId, documentId)) {
    return false;
  }

  const detail = value as DocumentDetail;

  return detail.processing_status === 'ready'
    ? isNonEmptyString(detail.extracted_text)
    : detail.extracted_text === null;
}

export function assertDocumentDetailResponse(
  value: unknown,
  projectId: string,
  documentId: string,
): DocumentDetail {
  if (!isDocumentDetailResponse(value, projectId, documentId)) {
    throw new Error(INVALID_DOCUMENT_MESSAGE);
  }

  return value;
}

export function createDocumentsApi(request: DocumentsRequest = requestJson) {
  function collectionPath(projectId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/documents`;
  }

  function resourcePath(projectId: string, documentId: string): string {
    return `${collectionPath(projectId)}/${encodeURIComponent(documentId)}`;
  }

  function getDocumentUploadPolicy(
    signal?: AbortSignal,
  ): Promise<DocumentUploadPolicyResponse> {
    return request<unknown>('/document-upload-policy', { signal }).then(
      assertDocumentUploadPolicyResponse,
    );
  }

  function getProjectDocuments(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<DocumentListResponse> {
    return request<unknown>(collectionPath(projectId), { signal }).then(
      (response) => assertDocumentListResponse(response, projectId),
    );
  }

  function getDocument(
    projectId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<DocumentDetail> {
    return request<unknown>(resourcePath(projectId, documentId), {
      signal,
    }).then((response) =>
      assertDocumentDetailResponse(response, projectId, documentId),
    );
  }

  function uploadDocument(
    projectId: string,
    input: UploadDocumentInput,
    signal?: AbortSignal,
  ): Promise<UploadDocumentResponse> {
    const body = new FormData();
    body.append('idempotency_key', input.idempotency_key);
    body.append('file', input.file, input.file.name);

    return request<unknown>(collectionPath(projectId), {
      body,
      method: 'POST',
      signal,
    }).then((response) => assertDocumentSummaryResponse(response, projectId));
  }

  function retryDocumentProcessing(
    projectId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<RetryDocumentProcessingResponse> {
    return request<unknown>(`${resourcePath(projectId, documentId)}/retry`, {
      method: 'POST',
      signal,
    }).then((response) =>
      assertDocumentSummaryResponse(response, projectId, documentId),
    );
  }

  return {
    getDocument,
    getDocumentUploadPolicy,
    getProjectDocuments,
    retryDocumentProcessing,
    uploadDocument,
  };
}

export const {
  getDocument,
  getDocumentUploadPolicy,
  getProjectDocuments,
  retryDocumentProcessing,
  uploadDocument,
} = createDocumentsApi();
