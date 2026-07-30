import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../database/database.provider';
import {
  DocumentIntegrityError,
  type ClaimDocumentProcessingLeaseInput,
  type CompleteDocumentProcessingInput,
  type DocumentProcessingErrorCode,
  type DocumentProcessingStatus,
  type DocumentProjectUsage,
  type DocumentRecord,
  type DocumentRepository,
  type FailDocumentProcessingInput,
  type NewDocumentRecord,
  type QueueDocumentProcessingRetryInput,
  type ReleaseDocumentProcessingLeaseInput,
  type RenewDocumentProcessingLeaseInput,
} from './document.types';

interface DocumentRow {
  id: unknown;
  project_id: unknown;
  title: unknown;
  original_filename: unknown;
  file_reference: unknown;
  format: unknown;
  mime_type: unknown;
  size_bytes: unknown;
  source_hash: unknown;
  extracted_text: unknown;
  processed_source_hash: unknown;
  processing_status: unknown;
  processing_error_code: unknown;
  processing_error_retryable: unknown;
  upload_idempotency_key: unknown;
  upload_request_fingerprint: unknown;
  processing_generation: unknown;
  processing_attempt_count: unknown;
  processing_started_at: unknown;
  processing_completed_at: unknown;
  processing_lease_owner: unknown;
  processing_lease_expires_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

@Injectable()
export class SqliteDocumentRepository implements DocumentRepository {
  private readonly database: DatabaseSync;

  constructor(databaseProvider: DatabaseProvider) {
    this.database = databaseProvider.connection;
  }

  create(document: NewDocumentRecord): DocumentRecord {
    const record = this.toDocument({
      ...document,
      extracted_text: null,
      processed_source_hash: null,
      processing_status: 'processing',
      processing_error_code: null,
      processing_error_retryable: 0,
      processing_generation: 1,
      processing_attempt_count: 0,
      processing_started_at: null,
      processing_completed_at: null,
      processing_lease_owner: null,
      processing_lease_expires_at: null,
    });

    this.database
      .prepare(
        `
          INSERT INTO documents (
            id,
            project_id,
            title,
            original_filename,
            file_reference,
            format,
            mime_type,
            size_bytes,
            source_hash,
            extracted_text,
            processed_source_hash,
            processing_status,
            processing_error_code,
            processing_error_retryable,
            upload_idempotency_key,
            upload_request_fingerprint,
            processing_generation,
            processing_attempt_count,
            processing_started_at,
            processing_completed_at,
            processing_lease_owner,
            processing_lease_expires_at,
            created_at,
            updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?
          )
        `,
      )
      .run(
        record.id,
        record.project_id,
        record.title,
        record.original_filename,
        record.file_reference,
        record.format,
        record.mime_type,
        record.size_bytes,
        record.source_hash,
        record.extracted_text,
        record.processed_source_hash,
        record.processing_status,
        record.processing_error_code,
        Number(record.processing_error_retryable),
        record.upload_idempotency_key,
        record.upload_request_fingerprint,
        record.processing_generation,
        record.processing_attempt_count,
        record.processing_started_at,
        record.processing_completed_at,
        record.processing_lease_owner,
        record.processing_lease_expires_at,
        record.created_at,
        record.updated_at,
      );

    return record;
  }

  findAllByProjectId(projectId: string): DocumentRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM documents
          WHERE project_id = ?
          ORDER BY created_at DESC, id ASC
        `,
      )
      .all(projectId) as unknown as DocumentRow[];

    return rows.map((row) => this.toDocument(row));
  }

  findProjectIdById(documentId: string): string | undefined {
    const row = this.database
      .prepare('SELECT project_id FROM documents WHERE id = ?')
      .get(documentId) as unknown as
      Pick<DocumentRow, 'project_id'> | undefined;

    if (row === undefined) {
      return undefined;
    }

    if (!this.isNonEmptyString(row.project_id)) {
      throw new DocumentIntegrityError(documentId);
    }

    return row.project_id;
  }

  findByProjectAndId(
    projectId: string,
    documentId: string,
  ): DocumentRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM documents
          WHERE project_id = ? AND id = ?
        `,
      )
      .get(projectId, documentId) as unknown as DocumentRow | undefined;

    return row ? this.toDocument(row) : undefined;
  }

  findByProjectAndUploadIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): DocumentRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT *
          FROM documents
          WHERE project_id = ? AND upload_idempotency_key = ?
        `,
      )
      .get(projectId, idempotencyKey) as unknown as DocumentRow | undefined;

    return row ? this.toDocument(row) : undefined;
  }

  getProjectUsage(projectId: string): DocumentProjectUsage {
    const row = this.database
      .prepare(
        `
          SELECT
            COUNT(*) AS document_count,
            COALESCE(SUM(size_bytes), 0) AS storage_bytes
          FROM documents
          WHERE project_id = ?
        `,
      )
      .get(projectId) as unknown as {
      document_count: unknown;
      storage_bytes: unknown;
    };

    if (
      !Number.isSafeInteger(row.document_count) ||
      (row.document_count as number) < 0 ||
      !Number.isSafeInteger(row.storage_bytes) ||
      (row.storage_bytes as number) < 0
    ) {
      throw new DocumentIntegrityError('project-usage');
    }

    return {
      document_count: row.document_count as number,
      storage_bytes: row.storage_bytes as number,
    };
  }

  claimProcessingLease(
    input: ClaimDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined {
    if (
      !this.isNonEmptyString(input.lease_owner) ||
      !this.isIsoTimestamp(input.claimed_at) ||
      !this.isIsoTimestamp(input.lease_expires_at) ||
      input.lease_expires_at <= input.claimed_at
    ) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            processing_attempt_count = processing_attempt_count + 1,
            processing_started_at = COALESCE(
              processing_started_at,
              ?
            ),
            processing_lease_owner = ?,
            processing_lease_expires_at = ?,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'processing'
            AND processing_generation = ?
            AND (
              processing_lease_owner IS NULL
              OR processing_lease_expires_at <= ?
            )
            AND updated_at <= ?
        `,
      )
      .run(
        input.claimed_at,
        input.lease_owner,
        input.lease_expires_at,
        input.claimed_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.claimed_at,
        input.claimed_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  renewProcessingLease(
    input: RenewDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined {
    if (
      !this.isIsoTimestamp(input.renewed_at) ||
      !this.isIsoTimestamp(input.lease_expires_at) ||
      input.lease_expires_at <= input.renewed_at
    ) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            processing_lease_expires_at = ?,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'processing'
            AND processing_generation = ?
            AND processing_lease_owner = ?
            AND processing_lease_expires_at > ?
            AND updated_at <= ?
        `,
      )
      .run(
        input.lease_expires_at,
        input.renewed_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.lease_owner,
        input.renewed_at,
        input.renewed_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  releaseProcessingLease(
    input: ReleaseDocumentProcessingLeaseInput,
  ): DocumentRecord | undefined {
    if (!this.isIsoTimestamp(input.released_at)) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            processing_lease_owner = NULL,
            processing_lease_expires_at = NULL,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'processing'
            AND processing_generation = ?
            AND processing_lease_owner = ?
            AND processing_lease_expires_at > ?
            AND updated_at <= ?
        `,
      )
      .run(
        input.released_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.lease_owner,
        input.released_at,
        input.released_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  completeProcessing(
    input: CompleteDocumentProcessingInput,
  ): DocumentRecord | undefined {
    if (
      !this.isIsoTimestamp(input.completed_at) ||
      !this.isNonEmptyString(input.extracted_text) ||
      !this.isHash(input.processed_source_hash)
    ) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            extracted_text = ?,
            processed_source_hash = ?,
            processing_status = 'ready',
            processing_error_code = NULL,
            processing_error_retryable = 0,
            processing_completed_at = ?,
            processing_lease_owner = NULL,
            processing_lease_expires_at = NULL,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'processing'
            AND processing_generation = ?
            AND processing_lease_owner = ?
            AND processing_lease_expires_at > ?
            AND updated_at <= ?
        `,
      )
      .run(
        input.extracted_text,
        input.processed_source_hash,
        input.completed_at,
        input.completed_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.lease_owner,
        input.completed_at,
        input.completed_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  failProcessing(
    input: FailDocumentProcessingInput,
  ): DocumentRecord | undefined {
    if (
      !this.isIsoTimestamp(input.completed_at) ||
      this.processingErrorCode(input.error_code) === undefined
    ) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            extracted_text = NULL,
            processed_source_hash = NULL,
            processing_status = 'failed',
            processing_error_code = ?,
            processing_error_retryable = ?,
            processing_completed_at = ?,
            processing_lease_owner = NULL,
            processing_lease_expires_at = NULL,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'processing'
            AND processing_generation = ?
            AND processing_lease_owner = ?
            AND processing_lease_expires_at > ?
            AND updated_at <= ?
        `,
      )
      .run(
        input.error_code,
        Number(input.retryable),
        input.completed_at,
        input.completed_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.lease_owner,
        input.completed_at,
        input.completed_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  queueProcessingRetry(
    input: QueueDocumentProcessingRetryInput,
  ): DocumentRecord | undefined {
    if (!this.isIsoTimestamp(input.queued_at)) {
      throw new DocumentIntegrityError(input.document_id);
    }

    const result = this.database
      .prepare(
        `
          UPDATE documents
          SET
            extracted_text = NULL,
            processed_source_hash = NULL,
            processing_status = 'processing',
            processing_error_code = NULL,
            processing_error_retryable = 0,
            processing_generation = processing_generation + 1,
            processing_attempt_count = 0,
            processing_started_at = NULL,
            processing_completed_at = NULL,
            processing_lease_owner = NULL,
            processing_lease_expires_at = NULL,
            updated_at = ?
          WHERE
            project_id = ?
            AND id = ?
            AND processing_status = 'failed'
            AND processing_error_retryable = 1
            AND processing_generation = ?
            AND updated_at <= ?
        `,
      )
      .run(
        input.queued_at,
        input.project_id,
        input.document_id,
        input.expected_generation,
        input.queued_at,
      );

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(input.project_id, input.document_id);
  }

  private toDocument(row: DocumentRow): DocumentRecord {
    const documentId = this.isNonEmptyString(row.id) ? row.id : 'unknown';
    const processingStatus = this.processingStatus(row.processing_status);
    const processingErrorCode = this.processingErrorCode(
      row.processing_error_code,
    );
    const processingErrorRetryable =
      row.processing_error_retryable === 0
        ? false
        : row.processing_error_retryable === 1
          ? true
          : undefined;

    if (
      !this.isNonEmptyString(row.id) ||
      !this.isNonEmptyString(row.project_id) ||
      !this.isBoundedString(row.title, 255) ||
      !this.isBoundedString(row.original_filename, 255) ||
      !this.isBoundedString(row.file_reference, 500) ||
      !this.isDocumentFormat(row.format) ||
      !this.isBoundedString(row.mime_type, 255) ||
      !Number.isSafeInteger(row.size_bytes) ||
      (row.size_bytes as number) <= 0 ||
      !this.isHash(row.source_hash) ||
      !this.isNullableString(row.extracted_text) ||
      !this.isNullableHash(row.processed_source_hash) ||
      processingStatus === undefined ||
      processingErrorCode === undefined ||
      processingErrorRetryable === undefined ||
      !this.isBoundedString(row.upload_idempotency_key, 200) ||
      !this.isHash(row.upload_request_fingerprint) ||
      !Number.isSafeInteger(row.processing_generation) ||
      (row.processing_generation as number) <= 0 ||
      !Number.isSafeInteger(row.processing_attempt_count) ||
      (row.processing_attempt_count as number) < 0 ||
      !this.isNullableIsoTimestamp(row.processing_started_at) ||
      !this.isNullableIsoTimestamp(row.processing_completed_at) ||
      !this.isNullableNonEmptyString(row.processing_lease_owner) ||
      !this.isNullableIsoTimestamp(row.processing_lease_expires_at) ||
      !this.isIsoTimestamp(row.created_at) ||
      !this.isIsoTimestamp(row.updated_at) ||
      row.updated_at < row.created_at
    ) {
      throw new DocumentIntegrityError(documentId);
    }

    const attemptCount = row.processing_attempt_count as number;
    const hasLeaseOwner = row.processing_lease_owner !== null;
    const hasLeaseExpiry = row.processing_lease_expires_at !== null;
    const hasStarted = row.processing_started_at !== null;
    const hasCompleted = row.processing_completed_at !== null;

    if (
      hasLeaseOwner !== hasLeaseExpiry ||
      (hasLeaseOwner && processingStatus !== 'processing') ||
      (row.processing_lease_expires_at !== null &&
        row.processing_lease_expires_at <= row.updated_at) ||
      (row.processing_started_at !== null &&
        row.processing_started_at < row.created_at) ||
      (row.processing_completed_at !== null &&
        (row.processing_started_at === null ||
          row.processing_completed_at < row.processing_started_at ||
          row.processing_completed_at > row.updated_at)) ||
      (processingStatus === 'processing' &&
        (row.extracted_text !== null ||
          row.processed_source_hash !== null ||
          processingErrorCode !== null ||
          processingErrorRetryable ||
          hasCompleted ||
          (attemptCount === 0 && (hasStarted || hasLeaseOwner)) ||
          (attemptCount > 0 && !hasStarted))) ||
      (processingStatus === 'ready' &&
        (!this.isNonEmptyString(row.extracted_text) ||
          row.processed_source_hash !== row.source_hash ||
          processingErrorCode !== null ||
          processingErrorRetryable ||
          attemptCount === 0 ||
          !hasStarted ||
          !hasCompleted ||
          hasLeaseOwner)) ||
      (processingStatus === 'failed' &&
        (row.extracted_text !== null ||
          row.processed_source_hash !== null ||
          processingErrorCode === null ||
          attemptCount === 0 ||
          !hasStarted ||
          !hasCompleted ||
          hasLeaseOwner))
    ) {
      throw new DocumentIntegrityError(documentId);
    }

    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      original_filename: row.original_filename,
      file_reference: row.file_reference,
      format: row.format,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes as number,
      source_hash: row.source_hash,
      extracted_text: row.extracted_text,
      processed_source_hash: row.processed_source_hash,
      processing_status: processingStatus,
      processing_error_code: processingErrorCode,
      processing_error_retryable: processingErrorRetryable,
      upload_idempotency_key: row.upload_idempotency_key,
      upload_request_fingerprint: row.upload_request_fingerprint,
      processing_generation: row.processing_generation as number,
      processing_attempt_count: attemptCount,
      processing_started_at: row.processing_started_at,
      processing_completed_at: row.processing_completed_at,
      processing_lease_owner: row.processing_lease_owner,
      processing_lease_expires_at: row.processing_lease_expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private processingStatus(
    value: unknown,
  ): DocumentProcessingStatus | undefined {
    return value === 'processing' || value === 'ready' || value === 'failed'
      ? value
      : undefined;
  }

  private processingErrorCode(
    value: unknown,
  ): DocumentProcessingErrorCode | null | undefined {
    if (value === null) {
      return null;
    }

    return value === 'unsafe' ||
      value === 'encrypted' ||
      value === 'corrupted' ||
      value === 'no_text' ||
      value === 'too_complex' ||
      value === 'storage_unavailable' ||
      value === 'scanner_unavailable' ||
      value === 'processing_unavailable' ||
      value === 'unknown'
      ? value
      : undefined;
  }

  private isDocumentFormat(value: unknown): value is DocumentRecord['format'] {
    return value === 'plain_text' || value === 'markdown' || value === 'pdf';
  }

  private isHash(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  }

  private isNullableHash(value: unknown): value is string | null {
    return value === null || this.isHash(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isBoundedString(
    value: unknown,
    maximumLength: number,
  ): value is string {
    return this.isNonEmptyString(value) && value.length <= maximumLength;
  }

  private isNullableNonEmptyString(value: unknown): value is string | null {
    return value === null || this.isNonEmptyString(value);
  }

  private isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
  }

  private isIsoTimestamp(value: unknown): value is string {
    if (typeof value !== 'string') {
      return false;
    }

    try {
      return new Date(value).toISOString() === value;
    } catch {
      return false;
    }
  }

  private isNullableIsoTimestamp(value: unknown): value is string | null {
    return value === null || this.isIsoTimestamp(value);
  }
}
