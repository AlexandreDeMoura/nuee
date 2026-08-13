import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type {
  DocumentDetail,
  DocumentListResponse,
  DocumentSummary,
  DocumentUploadPolicyResponse,
  RetryDocumentProcessingResponse,
} from '@nuee/shared-types';
import { documentsConfig } from '../config/configuration';
import type {
  DocumentContextSourceReadResult,
  DocumentContextSourceReader,
} from '../discussion-context/discussion-context.types';
import type { ProjectDocumentFilePurger } from '../projects/project.types';
import { ProjectsService } from '../projects/projects.service';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DocumentTelemetry,
  documentCorrelationId,
  documentSizeBand,
} from './document.telemetry';
import {
  DOCUMENT_FILE_STORAGE,
  DOCUMENT_PROCESSING_QUEUE,
  DOCUMENT_REPOSITORY,
  DocumentUploadValidationError,
  toDocumentDetail,
  toDocumentSummary,
  type DocumentFileStorage,
  type DocumentRecord,
  type DocumentProcessingQueue,
  type DocumentRepository,
  type UploadDocumentInput,
  type ValidatedDocumentUpload,
} from './document.types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

interface DocumentUploadResult {
  document: DocumentSummary;
  outcome: 'accepted' | 'idempotent_replay';
  retryCount: number;
}

@Injectable()
export class DocumentsService
  implements DocumentContextSourceReader, ProjectDocumentFilePurger
{
  private readonly projectUploadTails = new Map<string, Promise<void>>();

  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(DOCUMENT_FILE_STORAGE)
    private readonly fileStorage: DocumentFileStorage,
    private readonly projects: ProjectsService,
    private readonly validator: DocumentUploadValidator,
    @Inject(DOCUMENT_PROCESSING_QUEUE)
    private readonly processingQueue: DocumentProcessingQueue,
    @Inject(documentsConfig.KEY)
    private readonly config: ConfigType<typeof documentsConfig>,
    private readonly telemetry: DocumentTelemetry = new DocumentTelemetry(),
  ) {}

  async upload(
    projectId: string,
    input: UploadDocumentInput,
  ): Promise<DocumentSummary> {
    const startedAt = Date.now();
    const correlationId = documentCorrelationId(input?.idempotency_key);
    const inputBytes = input?.file?.bytes;
    const inputSize =
      inputBytes instanceof Uint8Array ? inputBytes.byteLength : 0;

    try {
      const result = await this.persistUpload(projectId, input);
      this.telemetry.record({
        event: 'document_upload_finished',
        project_id: projectId,
        document_id: result.document.id,
        correlation_id: correlationId,
        format_category: result.document.format,
        size_band: documentSizeBand(result.document.size_bytes),
        duration_ms: Math.max(0, Date.now() - startedAt),
        retry_count: result.retryCount,
        outcome: result.outcome,
        error_code: null,
      });
      return result.document;
    } catch (error) {
      this.telemetry.record({
        event: 'document_upload_finished',
        project_id: projectId,
        document_id: null,
        correlation_id: correlationId,
        format_category: 'unknown',
        size_band: documentSizeBand(inputSize),
        duration_ms: Math.max(0, Date.now() - startedAt),
        retry_count: 0,
        outcome: 'failed',
        error_code: this.applicationErrorCode(error),
      });
      throw error;
    }
  }

  private async persistUpload(
    projectId: string,
    input: UploadDocumentInput,
  ): Promise<DocumentUploadResult> {
    this.projects.get(projectId);

    const idempotencyKey = this.validateIdempotencyKey(input?.idempotency_key);
    const upload = await this.validateFile(input?.file);

    return this.withProjectUploadLock(projectId, async () => {
      const replay = this.resolveIdempotentReplay(
        projectId,
        idempotencyKey,
        upload.request_fingerprint,
      );

      if (replay) {
        this.scheduleProcessing(replay);
        return {
          document: toDocumentSummary(replay),
          outcome: 'idempotent_replay',
          retryCount: 1,
        };
      }

      this.enforceProjectQuota(projectId, upload.size_bytes);

      let fileReference: string;

      try {
        const stored = await this.fileStorage.store(upload.bytes);
        fileReference = stored.file_reference;
      } catch {
        throw new ServiceUnavailableException({
          code: 'DOCUMENT_STORAGE_UNAVAILABLE',
          message: 'The document could not be stored. Please retry.',
        });
      }

      let created: DocumentRecord;

      try {
        const timestamp = new Date().toISOString();
        created = this.documents.create({
          id: randomUUID(),
          project_id: projectId,
          title: upload.title,
          original_filename: upload.original_filename,
          file_reference: fileReference,
          format: upload.format,
          mime_type: upload.mime_type,
          size_bytes: upload.size_bytes,
          source_hash: upload.source_hash,
          upload_idempotency_key: idempotencyKey,
          upload_request_fingerprint: upload.request_fingerprint,
          created_at: timestamp,
          updated_at: timestamp,
        });
      } catch {
        await this.compensateStoredFile(fileReference);

        const replay = this.resolveIdempotentReplay(
          projectId,
          idempotencyKey,
          upload.request_fingerprint,
        );

        if (replay) {
          return {
            document: toDocumentSummary(replay),
            outcome: 'idempotent_replay',
            retryCount: 1,
          };
        }

        throw new InternalServerErrorException({
          code: 'DOCUMENT_UPLOAD_PERSISTENCE_FAILED',
          message: 'The document upload could not be recorded. Please retry.',
        });
      }

      this.scheduleProcessing(created);
      return {
        document: toDocumentSummary(created),
        outcome: 'accepted',
        retryCount: 0,
      };
    });
  }

  uploadPolicy(): DocumentUploadPolicyResponse {
    return {
      supported_formats: this.config.supported_formats.map((format) => ({
        category: format.category,
        extensions: [...format.extensions],
        mime_types: [...format.mime_types],
      })),
      max_file_size_bytes: this.config.max_file_size_bytes,
      max_files_per_request: this.config.max_files_per_request,
      max_documents_per_project: this.config.max_documents_per_project,
      max_project_storage_bytes: this.config.max_project_storage_bytes,
    };
  }

  list(projectId: string): DocumentListResponse {
    this.projects.get(projectId);

    return this.documents
      .findAllByProjectId(projectId)
      .map((document) => toDocumentSummary(document));
  }

  get(projectId: string, documentId: string): DocumentDetail {
    this.projects.get(projectId);

    return toDocumentDetail(this.getPersisted(projectId, documentId));
  }

  retry(
    projectId: string,
    documentId: string,
  ): RetryDocumentProcessingResponse {
    const startedAt = Date.now();

    try {
      const result = this.queueProcessingRetry(projectId, documentId);
      const persisted = this.getPersisted(projectId, documentId);
      this.recordProcessingRetry(persisted, startedAt, 'accepted', null);
      return result;
    } catch (error) {
      const persisted = this.documents.findByProjectAndId(
        projectId,
        documentId,
      );
      if (persisted) {
        this.recordProcessingRetry(
          persisted,
          startedAt,
          'failed',
          this.applicationErrorCode(error),
        );
      }
      throw error;
    }
  }

  private queueProcessingRetry(
    projectId: string,
    documentId: string,
  ): RetryDocumentProcessingResponse {
    this.projects.get(projectId);
    const document = this.getPersisted(projectId, documentId);

    if (
      document.processing_status !== 'failed' ||
      !document.processing_error_retryable
    ) {
      throw new ConflictException({
        code: 'DOCUMENT_PROCESSING_RETRY_UNAVAILABLE',
        message: 'This document is not eligible for processing retry.',
      });
    }

    const queued = this.documents.queueProcessingRetry({
      project_id: projectId,
      document_id: documentId,
      expected_generation: document.processing_generation,
      queued_at: this.nextTimestamp(document.updated_at),
    });

    if (!queued) {
      throw new ConflictException({
        code: 'DOCUMENT_PROCESSING_RETRY_CONFLICT',
        message:
          'The document processing state changed before the retry was queued. Refresh the document and try again.',
      });
    }

    this.scheduleProcessing(queued);
    return toDocumentSummary(queued);
  }

  readContextSource(
    projectId: string,
    documentId: string,
  ): DocumentContextSourceReadResult {
    const document = this.documents.findByProjectAndId(projectId, documentId);

    if (!document) {
      return {
        status: 'unavailable',
        reason:
          this.documents.findProjectIdById(documentId) === undefined
            ? 'missing'
            : 'cross_project',
      };
    }

    const detail = toDocumentDetail(document);

    return {
      status: 'available',
      source: {
        id: detail.id,
        project_id: detail.project_id,
        title: detail.title,
        processing_status: detail.processing_status,
        processed_text:
          detail.processing_status === 'ready' ? detail.extracted_text : null,
      },
    };
  }

  listProjectFileReferences(projectId: string): string[] {
    return this.documents.findFileReferencesByProjectId(projectId);
  }

  async removeFiles(
    projectId: string,
    fileReferences: readonly string[],
  ): Promise<number> {
    let removedCount = 0;

    for (const fileReference of fileReferences) {
      try {
        await this.fileStorage.remove(fileReference);
        removedCount += 1;
      } catch (error) {
        // The owning records are already gone, so one unlink failure must not
        // abandon the remaining originals or fail the caller's deletion.
        this.telemetry.record({
          event: 'document_file_cleanup_failed',
          project_id: projectId,
          file_reference: fileReference,
          error_code: this.applicationErrorCode(error),
        });
      }
    }

    return removedCount;
  }

  private async validateFile(
    file: UploadDocumentInput['file'],
  ): Promise<ValidatedDocumentUpload> {
    try {
      return await this.validator.validate(file);
    } catch (error) {
      if (!(error instanceof DocumentUploadValidationError)) {
        throw error;
      }

      if (error.code === 'validation_unavailable') {
        throw new ServiceUnavailableException({
          code: 'DOCUMENT_VALIDATION_UNAVAILABLE',
          message: error.message,
        });
      }

      if (error.code === 'file_too_large' || error.code === 'pdf_too_complex') {
        throw new PayloadTooLargeException({
          code: 'DOCUMENT_UPLOAD_LIMIT_EXCEEDED',
          message: error.message,
          reason: error.code,
          max_file_size_bytes: this.config.max_file_size_bytes,
          max_pdf_pages: this.config.maxPdfPages,
        });
      }

      throw new BadRequestException({
        code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
        message: 'The selected document is invalid.',
        reason: error.code,
        field_errors: {
          file: error.message,
        },
      });
    }
  }

  private validateIdempotencyKey(value: unknown): string {
    if (typeof value !== 'string') {
      throw this.invalidIdempotencyKey();
    }

    const key = value.trim();

    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw this.invalidIdempotencyKey();
    }

    return key;
  }

  private enforceProjectQuota(
    projectId: string,
    incomingSizeBytes: number,
  ): void {
    const usage = this.documents.getProjectUsage(projectId);

    if (usage.document_count >= this.config.max_documents_per_project) {
      throw new PayloadTooLargeException({
        code: 'DOCUMENT_PROJECT_QUOTA_EXCEEDED',
        message: `A project may contain at most ${this.config.max_documents_per_project} documents.`,
        quota: 'document_count',
        max_documents_per_project: this.config.max_documents_per_project,
      });
    }

    if (
      usage.storage_bytes + incomingSizeBytes >
      this.config.max_project_storage_bytes
    ) {
      throw new PayloadTooLargeException({
        code: 'DOCUMENT_PROJECT_QUOTA_EXCEEDED',
        message: `A project may store at most ${this.config.max_project_storage_bytes} bytes of original documents.`,
        quota: 'storage_bytes',
        max_project_storage_bytes: this.config.max_project_storage_bytes,
      });
    }
  }

  private resolveIdempotentReplay(
    projectId: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ): DocumentRecord | undefined {
    const existing = this.documents.findByProjectAndUploadIdempotencyKey(
      projectId,
      idempotencyKey,
    );

    if (!existing) {
      return undefined;
    }

    if (existing.upload_request_fingerprint !== requestFingerprint) {
      throw this.idempotencyConflict();
    }

    return existing;
  }

  private getPersisted(projectId: string, documentId: string): DocumentRecord {
    const document = this.documents.findByProjectAndId(projectId, documentId);

    if (!document) {
      throw new NotFoundException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `Document "${documentId}" was not found in project "${projectId}".`,
      });
    }

    return document;
  }

  private async compensateStoredFile(fileReference: string): Promise<void> {
    try {
      await this.fileStorage.remove(fileReference);
    } catch {
      throw new InternalServerErrorException({
        code: 'DOCUMENT_UPLOAD_CLEANUP_FAILED',
        message: 'The failed upload could not be cleaned up safely.',
      });
    }
  }

  private scheduleProcessing(document: DocumentRecord): void {
    if (document.processing_status !== 'processing') {
      return;
    }

    this.processingQueue.schedule({
      project_id: document.project_id,
      document_id: document.id,
      processing_generation: document.processing_generation,
    });
  }

  private async withProjectUploadLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous =
      this.projectUploadTails.get(projectId) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });

    this.projectUploadTails.set(projectId, current);
    await previous;

    try {
      return await operation();
    } finally {
      releaseCurrent();

      if (this.projectUploadTails.get(projectId) === current) {
        this.projectUploadTails.delete(projectId);
      }
    }
  }

  private invalidIdempotencyKey(): BadRequestException {
    return new BadRequestException({
      code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
      message: 'The document upload request is invalid.',
      field_errors: {
        idempotency_key: `Idempotency key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer.`,
      },
    });
  }

  private idempotencyConflict(): ConflictException {
    return new ConflictException({
      code: 'DOCUMENT_UPLOAD_IDEMPOTENCY_CONFLICT',
      message:
        'This idempotency key was already used for a different document upload.',
    });
  }

  private nextTimestamp(previousTimestamp: string): string {
    const currentTime = Date.now();
    const previousTime = new Date(previousTimestamp).getTime();

    return new Date(Math.max(currentTime, previousTime + 1)).toISOString();
  }

  private recordProcessingRetry(
    document: DocumentRecord,
    startedAt: number,
    outcome: 'accepted' | 'failed',
    errorCode: string | null,
  ): void {
    this.telemetry.record({
      event: 'document_processing_retry_finished',
      project_id: document.project_id,
      document_id: document.id,
      correlation_id: documentCorrelationId(document.id),
      format_category: document.format,
      size_band: documentSizeBand(document.size_bytes),
      duration_ms: Math.max(0, Date.now() - startedAt),
      retry_count: Math.max(0, document.processing_generation - 1),
      outcome,
      error_code: errorCode,
    });
  }

  private applicationErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (response && typeof response === 'object') {
        const code: unknown = (response as { code?: unknown }).code;
        if (typeof code === 'string' && code.length > 0) {
          return code;
        }
      }
    }

    return 'DOCUMENT_UNKNOWN_FAILURE';
  }
}
