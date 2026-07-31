import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DocumentsConfig } from '../config/configuration';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { DocumentUploadValidator } from './document-upload.validator';
import {
  DocumentFileStorageError,
  type DocumentFileStorage,
  type DocumentRecord,
  type DocumentProcessingQueue,
  type DocumentUploadRepository,
  type PdfUploadInspector,
  type StoredDocumentFile,
  type UploadDocumentInput,
} from './document.types';
import { DocumentsService } from './documents.service';
import { SqliteDocumentRepository } from './sqlite-document.repository';

class FakeDocumentFileStorage implements DocumentFileStorage {
  readonly files = new Map<string, Buffer>();
  storeCount = 0;
  removeCount = 0;
  failStore = false;
  failRemove = false;

  store(bytes: Uint8Array): Promise<StoredDocumentFile> {
    this.storeCount += 1;

    if (this.failStore) {
      return Promise.reject(new DocumentFileStorageError('store'));
    }

    const fileReference = `originals/aa/file-${this.storeCount}`;
    this.files.set(fileReference, Buffer.from(bytes));
    return Promise.resolve({ file_reference: fileReference });
  }

  read(fileReference: string): Promise<Buffer> {
    const bytes = this.files.get(fileReference);

    return bytes
      ? Promise.resolve(Buffer.from(bytes))
      : Promise.reject(new DocumentFileStorageError('read'));
  }

  remove(fileReference: string): Promise<void> {
    this.removeCount += 1;

    if (this.failRemove) {
      return Promise.reject(new DocumentFileStorageError('remove'));
    }

    this.files.delete(fileReference);
    return Promise.resolve();
  }
}

class FailingDocumentUploadRepository implements DocumentUploadRepository {
  constructor(private readonly delegate: DocumentUploadRepository) {}

  create(): DocumentRecord {
    throw new Error('private sqlite details');
  }

  findByProjectAndUploadIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): DocumentRecord | undefined {
    return this.delegate.findByProjectAndUploadIdempotencyKey(
      projectId,
      idempotencyKey,
    );
  }

  getProjectUsage(projectId: string) {
    return this.delegate.getProjectUsage(projectId);
  }
}

describe('DocumentsService upload creation', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteDocumentRepository;
  let storage: FakeDocumentFileStorage;
  let config: DocumentsConfig;
  let validator: DocumentUploadValidator;
  let processingQueue: DocumentProcessingQueue;
  let scheduleProcessing: jest.Mock;
  let service: DocumentsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteDocumentRepository(databaseProvider);
    storage = new FakeDocumentFileStorage();
    config = {
      privateStoragePath: undefined,
      supported_formats: [
        {
          category: 'plain_text',
          extensions: ['.txt'],
          mime_types: ['text/plain'],
        },
        {
          category: 'markdown',
          extensions: ['.md'],
          mime_types: ['text/markdown', 'text/plain'],
        },
        {
          category: 'pdf',
          extensions: ['.pdf'],
          mime_types: ['application/pdf'],
        },
      ],
      max_file_size_bytes: 1024,
      max_files_per_request: 1,
      max_documents_per_project: 25,
      max_project_storage_bytes: 4096,
      maxPdfPages: 200,
      maxExtractedTextBytes: 2048,
      processingTimeoutMs: 30_000,
      processingLeaseMs: 45_000,
      maxProcessingConcurrency: 2,
      maxProcessingAttempts: 3,
      malwareScannerHost: '127.0.0.1',
      malwareScannerPort: 3310,
      malwareScannerTimeoutMs: 10_000,
    };
    scheduleProcessing = jest.fn();
    processingQueue = { schedule: scheduleProcessing };
    const pdfInspector: PdfUploadInspector = {
      inspect: () => Promise.resolve({ page_count: 1 }),
    };
    validator = new DocumentUploadValidator(config, pdfInspector);
    service = createService(repository);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createService(
    uploadRepository: DocumentUploadRepository,
  ): DocumentsService {
    return new DocumentsService(
      uploadRepository,
      storage,
      projects,
      validator,
      processingQueue,
      config,
    );
  }

  function createProject() {
    return projects.create({
      title: 'Document project',
      description: 'Sources for the document project.',
    });
  }

  function uploadInput(
    idempotencyKey: string,
    content = 'Complete source text.',
  ): UploadDocumentInput {
    return {
      idempotency_key: idempotencyKey,
      file: {
        original_filename: 'research_notes.txt',
        declared_mime_type: 'text/plain',
        bytes: Buffer.from(content, 'utf8'),
      },
    };
  }

  it('stores an accepted source privately before creating its processing record', async () => {
    const project = createProject();

    const result = await service.upload(project.id, uploadInput('upload-a'));
    const [record] = repository.findAllByProjectId(project.id);

    expect(result).toEqual({
      id: record?.id,
      project_id: project.id,
      title: 'research notes',
      original_filename: 'research_notes.txt',
      format: 'plain_text',
      mime_type: 'text/plain',
      size_bytes: 21,
      created_at: '2026-07-30T12:00:00.000Z',
      updated_at: '2026-07-30T12:00:00.000Z',
      processing_status: 'processing',
      processing_error_code: null,
      can_retry: false,
    });
    expect(record).toMatchObject({
      file_reference: 'originals/aa/file-1',
      upload_idempotency_key: 'upload-a',
    });
    expect(record.source_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(record.upload_request_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(storage.files.get(record.file_reference)?.toString('utf8')).toBe(
      'Complete source text.',
    );
    expect(scheduleProcessing).toHaveBeenCalledWith({
      project_id: project.id,
      document_id: record.id,
      processing_generation: 1,
    });
  });

  it('replays the same request without another file or record and conflicts on changed input', async () => {
    const project = createProject();
    const first = await service.upload(project.id, uploadInput('upload-a'));
    const replay = await service.upload(project.id, uploadInput('upload-a'));

    expect(replay).toEqual(first);
    expect(repository.findAllByProjectId(project.id)).toHaveLength(1);
    expect(storage.storeCount).toBe(1);

    await expect(
      service.upload(
        project.id,
        uploadInput('upload-a', 'Different source text.'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.storeCount).toBe(1);
  });

  it('allows intentional duplicate files and filenames under distinct request keys', async () => {
    const project = createProject();

    const first = await service.upload(project.id, uploadInput('upload-a'));
    const second = await service.upload(project.id, uploadInput('upload-b'));

    expect(first.id).not.toBe(second.id);
    expect(first.original_filename).toBe(second.original_filename);
    expect(repository.findAllByProjectId(project.id)).toHaveLength(2);
    expect(storage.storeCount).toBe(2);
  });

  it('enforces document-count quotas before writing another source file', async () => {
    const project = createProject();
    config.max_documents_per_project = 1;

    await service.upload(project.id, uploadInput('upload-a'));

    await expect(
      service.upload(project.id, uploadInput('upload-b')),
    ).rejects.toHaveProperty(
      'response.code',
      'DOCUMENT_PROJECT_QUOTA_EXCEEDED',
    );
    await expect(
      service.upload(project.id, uploadInput('upload-c')),
    ).rejects.toHaveProperty('response.quota', 'document_count');
    expect(storage.storeCount).toBe(1);
  });

  it('enforces aggregate byte quotas before writing another source file', async () => {
    const project = createProject();
    config.max_project_storage_bytes = 30;

    await service.upload(project.id, uploadInput('upload-a'));

    await expect(
      service.upload(project.id, uploadInput('upload-b')),
    ).rejects.toHaveProperty(
      'response.code',
      'DOCUMENT_PROJECT_QUOTA_EXCEEDED',
    );
    await expect(
      service.upload(project.id, uploadInput('upload-c')),
    ).rejects.toHaveProperty('response.quota', 'storage_bytes');
    expect(storage.storeCount).toBe(1);
  });

  it('serializes concurrent same-project uploads around quota checks', async () => {
    const project = createProject();
    config.max_documents_per_project = 1;

    const results = await Promise.allSettled([
      service.upload(project.id, uploadInput('upload-a')),
      service.upload(project.id, uploadInput('upload-b')),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(repository.findAllByProjectId(project.id)).toHaveLength(1);
    expect(storage.storeCount).toBe(1);
  });

  it('removes an orphaned source when record creation fails', async () => {
    const project = createProject();
    service = createService(new FailingDocumentUploadRepository(repository));

    await expect(
      service.upload(project.id, uploadInput('upload-a')),
    ).rejects.toHaveProperty(
      'response.code',
      'DOCUMENT_UPLOAD_PERSISTENCE_FAILED',
    );
    expect(repository.findAllByProjectId(project.id)).toEqual([]);
    expect(storage.files.size).toBe(0);
    expect(storage.removeCount).toBe(1);
  });

  it('reports cleanup failure without exposing persistence or storage details', async () => {
    const project = createProject();
    storage.failRemove = true;
    service = createService(new FailingDocumentUploadRepository(repository));

    await expect(
      service.upload(project.id, uploadInput('upload-a')),
    ).rejects.toHaveProperty('response.code', 'DOCUMENT_UPLOAD_CLEANUP_FAILED');
  });

  it('does not store input for missing projects or invalid uploads', async () => {
    await expect(
      service.upload('missing-project', uploadInput('upload-a')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.storeCount).toBe(0);

    const project = createProject();
    await expect(
      service.upload(project.id, {
        idempotency_key: 'upload-invalid',
        file: {
          original_filename: 'malware.exe',
          declared_mime_type: 'application/octet-stream',
          bytes: Buffer.from('binary'),
        },
      }),
    ).rejects.toHaveProperty(
      'response.code',
      'DOCUMENT_UPLOAD_VALIDATION_FAILED',
    );
    expect(repository.findAllByProjectId(project.id)).toEqual([]);
    expect(storage.storeCount).toBe(0);
  });
});
