import type {
  DocumentFormatCategory,
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
  DocumentSummary,
} from '@nuee/shared-types';

export type {
  DocumentDetail,
  DocumentFormatCategory,
  DocumentListResponse,
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
  DocumentSummary,
} from '@nuee/shared-types';

export interface NewDocumentRecord {
  id: string;
  project_id: string;
  title: string;
  original_filename: string;
  file_reference: string;
  format: DocumentFormatCategory;
  mime_type: string;
  size_bytes: number;
  source_hash: string;
  upload_idempotency_key: string;
  upload_request_fingerprint: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord extends NewDocumentRecord {
  extracted_text: string | null;
  processed_source_hash: string | null;
  processing_status: DocumentProcessingStatus;
  processing_error_code: DocumentProcessingErrorCode | null;
  processing_error_retryable: boolean;
  processing_generation: number;
  processing_attempt_count: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  processing_lease_owner: string | null;
  processing_lease_expires_at: string | null;
}

export interface DocumentProjectUsage {
  document_count: number;
  storage_bytes: number;
}

/**
 * Complete in-memory file handed to the upload boundary after multipart
 * transfer finishes. Transfer progress and incomplete multipart requests
 * remain outside the durable document lifecycle.
 */
export interface DocumentUploadFile {
  original_filename: unknown;
  declared_mime_type: unknown;
  bytes: unknown;
}

export interface UploadDocumentInput {
  idempotency_key: unknown;
  file: DocumentUploadFile;
}

export interface ValidatedDocumentUpload {
  original_filename: string;
  title: string;
  format: DocumentFormatCategory;
  mime_type: string;
  size_bytes: number;
  source_hash: string;
  request_fingerprint: string;
  bytes: Buffer;
}

export type DocumentUploadValidationErrorCode =
  | 'filename_invalid'
  | 'unsupported_extension'
  | 'mime_type_invalid'
  | 'mime_type_mismatch'
  | 'empty_file'
  | 'file_too_large'
  | 'invalid_utf8'
  | 'binary_content'
  | 'invalid_pdf'
  | 'encrypted_pdf'
  | 'pdf_too_complex'
  | 'validation_unavailable';

export class DocumentUploadValidationError extends Error {
  constructor(
    readonly code: DocumentUploadValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentUploadValidationError';
  }
}

export interface PdfUploadInspection {
  page_count: number;
}

export type PdfUploadInspectionErrorCode =
  'corrupted' | 'encrypted' | 'unavailable';

export class PdfUploadInspectionError extends Error {
  constructor(
    readonly code: PdfUploadInspectionErrorCode,
    options?: ErrorOptions,
  ) {
    super('The PDF could not be inspected safely.', options);
    this.name = 'PdfUploadInspectionError';
  }
}

export interface PdfUploadInspector {
  inspect(bytes: Uint8Array): Promise<PdfUploadInspection>;
}

export interface StoredDocumentFile {
  file_reference: string;
}

export interface DocumentFileStorage {
  store(bytes: Uint8Array): Promise<StoredDocumentFile>;
  read(fileReference: string): Promise<Buffer>;
  remove(fileReference: string): Promise<void>;
}

export type DocumentMalwareScanResult = 'clean' | 'unsafe';

export interface DocumentMalwareScanner {
  scan(
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<DocumentMalwareScanResult>;
}

export class DocumentMalwareScannerError extends Error {
  constructor(options?: ErrorOptions) {
    super('Document malware scanning is unavailable.', options);
    this.name = 'DocumentMalwareScannerError';
  }
}

export interface DocumentTextExtractionLimits {
  max_output_bytes: number;
  max_pdf_pages: number;
}

export interface ExtractDocumentTextInput {
  bytes: Uint8Array;
  signal: AbortSignal;
  limits: DocumentTextExtractionLimits;
}

export interface DocumentTextExtractor {
  extract(input: ExtractDocumentTextInput): Promise<string>;
}

export class DocumentTextExtractionError extends Error {
  constructor(
    readonly code:
      | 'encrypted'
      | 'corrupted'
      | 'no_text'
      | 'too_complex'
      | 'processing_unavailable',
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super('The document text could not be extracted safely.', options);
    this.name = 'DocumentTextExtractionError';
  }
}

export interface ScheduleDocumentProcessingInput {
  project_id: string;
  document_id: string;
  processing_generation: number;
}

export interface DocumentProcessingQueue {
  schedule(input?: ScheduleDocumentProcessingInput): void;
}

export type DocumentFileStorageOperation = 'store' | 'read' | 'remove';

export class DocumentFileStorageError extends Error {
  constructor(
    readonly operation: DocumentFileStorageOperation,
    options?: ErrorOptions,
  ) {
    super('Private document storage is unavailable.', options);
    this.name = 'DocumentFileStorageError';
  }
}

export interface DocumentUploadRepository {
  create(document: NewDocumentRecord): DocumentRecord;
  findByProjectAndUploadIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): DocumentRecord | undefined;
  getProjectUsage(projectId: string): DocumentProjectUsage;
}

export function toDocumentSummary(record: DocumentRecord): DocumentSummary {
  const base = {
    id: record.id,
    project_id: record.project_id,
    title: record.title,
    original_filename: record.original_filename,
    format: record.format,
    mime_type: record.mime_type,
    size_bytes: record.size_bytes,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };

  if (record.processing_status === 'failed') {
    if (record.processing_error_code === null) {
      throw new DocumentIntegrityError(record.id);
    }

    return {
      ...base,
      processing_status: 'failed',
      processing_error_code: record.processing_error_code,
      can_retry: record.processing_error_retryable,
    };
  }

  return {
    ...base,
    processing_status: record.processing_status,
    processing_error_code: null,
    can_retry: false,
  };
}

export interface ClaimDocumentProcessingLeaseInput {
  project_id: string;
  document_id: string;
  expected_generation: number;
  lease_owner: string;
  claimed_at: string;
  lease_expires_at: string;
}

export interface RenewDocumentProcessingLeaseInput {
  project_id: string;
  document_id: string;
  expected_generation: number;
  lease_owner: string;
  renewed_at: string;
  lease_expires_at: string;
}

export interface OwnedDocumentProcessingLease {
  project_id: string;
  document_id: string;
  expected_generation: number;
  lease_owner: string;
}

export interface ReleaseDocumentProcessingLeaseInput extends OwnedDocumentProcessingLease {
  released_at: string;
}

export interface CompleteDocumentProcessingInput extends OwnedDocumentProcessingLease {
  extracted_text: string;
  processed_source_hash: string;
  completed_at: string;
}

export interface FailDocumentProcessingInput extends OwnedDocumentProcessingLease {
  error_code: DocumentProcessingErrorCode;
  retryable: boolean;
  completed_at: string;
}

export interface QueueDocumentProcessingRetryInput {
  project_id: string;
  document_id: string;
  expected_generation: number;
  queued_at: string;
}

export interface DocumentRepository {
  create(document: NewDocumentRecord): DocumentRecord;
  findAllByProjectId(projectId: string): DocumentRecord[];
  findProjectIdById(documentId: string): string | undefined;
  findByProjectAndId(
    projectId: string,
    documentId: string,
  ): DocumentRecord | undefined;
  findByProjectAndUploadIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): DocumentRecord | undefined;
  getProjectUsage(projectId: string): DocumentProjectUsage;
  findProcessingCandidates(
    availableAt: string,
    limit: number,
  ): DocumentRecord[];
  claimProcessingLease(
    input: ClaimDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined;
  renewProcessingLease(
    input: RenewDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined;
  releaseProcessingLease(
    input: ReleaseDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined;
  completeProcessing(
    input: CompleteDocumentProcessingInput,
  ): DocumentRecord | undefined;
  failProcessing(
    input: FailDocumentProcessingInput,
  ): DocumentRecord | undefined;
  queueProcessingRetry(
    input: QueueDocumentProcessingRetryInput,
  ): DocumentRecord | undefined;
}

export class DocumentIntegrityError extends Error {
  readonly code = 'DOCUMENT_CORRUPT';

  constructor(documentId: string) {
    super(`The persisted document "${documentId}" is incomplete or corrupt.`);
    this.name = 'DocumentIntegrityError';
  }
}

export const DOCUMENT_REPOSITORY = Symbol('DOCUMENT_REPOSITORY');
export const DOCUMENT_FILE_STORAGE = Symbol('DOCUMENT_FILE_STORAGE');
export const PDF_UPLOAD_INSPECTOR = Symbol('PDF_UPLOAD_INSPECTOR');
export const DOCUMENT_MALWARE_SCANNER = Symbol('DOCUMENT_MALWARE_SCANNER');
export const DOCUMENT_PROCESSING_QUEUE = Symbol('DOCUMENT_PROCESSING_QUEUE');
