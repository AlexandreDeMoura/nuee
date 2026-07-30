import type {
  DocumentFormatCategory,
  DocumentProcessingErrorCode,
  DocumentProcessingStatus,
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
