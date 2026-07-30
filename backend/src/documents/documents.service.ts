import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { DocumentSummary } from '@nuee/shared-types';
import { documentsConfig } from '../config/configuration';
import { ProjectsService } from '../projects/projects.service';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DOCUMENT_FILE_STORAGE,
  DOCUMENT_REPOSITORY,
  DocumentUploadValidationError,
  toDocumentSummary,
  type DocumentFileStorage,
  type DocumentRecord,
  type DocumentUploadRepository,
  type UploadDocumentInput,
  type ValidatedDocumentUpload,
} from './document.types';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

@Injectable()
export class DocumentsService {
  private readonly projectUploadTails = new Map<string, Promise<void>>();

  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentUploadRepository,
    @Inject(DOCUMENT_FILE_STORAGE)
    private readonly fileStorage: DocumentFileStorage,
    private readonly projects: ProjectsService,
    private readonly validator: DocumentUploadValidator,
    @Inject(documentsConfig.KEY)
    private readonly config: ConfigType<typeof documentsConfig>,
  ) {}

  async upload(
    projectId: string,
    input: UploadDocumentInput,
  ): Promise<DocumentSummary> {
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
        return toDocumentSummary(replay);
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
          return toDocumentSummary(replay);
        }

        throw new InternalServerErrorException({
          code: 'DOCUMENT_UPLOAD_PERSISTENCE_FAILED',
          message: 'The document upload could not be recorded. Please retry.',
        });
      }

      return toDocumentSummary(created);
    });
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
}
