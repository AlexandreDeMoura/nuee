import { createHash } from 'node:crypto';
import type { DocumentsConfig } from '../config/configuration';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { DocumentProcessingCoordinator } from './document-processing.coordinator';
import { DocumentTextNormalizer } from './document-text.normalizer';
import {
  DocumentFileStorageError,
  DocumentMalwareScannerError,
  type DocumentFileStorage,
  type DocumentMalwareScanner,
  type DocumentMalwareScanResult,
  type NewDocumentRecord,
  type StoredDocumentFile,
} from './document.types';
import { PdfJsDocumentTextExtractor } from './pdfjs-document-text.extractor';
import { SqliteDocumentRepository } from './sqlite-document.repository';
import {
  MarkdownDocumentTextExtractor,
  PlainTextDocumentTextExtractor,
} from './utf8-document-text.extractors';

class FakeDocumentFileStorage implements DocumentFileStorage {
  readonly files = new Map<string, Buffer>();
  lastRead: Buffer | undefined;
  failReads = false;

  store(): Promise<StoredDocumentFile> {
    throw new Error('Not used by processing tests.');
  }

  read(fileReference: string): Promise<Buffer> {
    if (this.failReads) {
      return Promise.reject(new DocumentFileStorageError('read'));
    }

    const stored = this.files.get(fileReference);

    if (!stored) {
      return Promise.reject(new DocumentFileStorageError('read'));
    }

    this.lastRead = Buffer.from(stored);
    return Promise.resolve(this.lastRead);
  }

  remove(): Promise<void> {
    throw new Error('Not used by processing tests.');
  }
}

class FakeDocumentMalwareScanner implements DocumentMalwareScanner {
  results: Array<DocumentMalwareScanResult | Error> = ['clean'];
  calls = 0;
  active = 0;
  maximumActive = 0;
  delayMs = 0;

  async scan(
    _bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<DocumentMalwareScanResult> {
    this.calls += 1;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);

    try {
      if (this.delayMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(resolve, this.delayMs);
          const abort = () => {
            clearTimeout(timeout);
            reject(new DocumentMalwareScannerError({ cause: signal.reason }));
          };
          signal.addEventListener('abort', abort, { once: true });
        });
      }

      const result =
        this.results[Math.min(this.calls - 1, this.results.length - 1)];

      if (result instanceof Error) {
        throw result;
      }

      return result ?? 'clean';
    } finally {
      this.active -= 1;
    }
  }
}

describe('DocumentProcessingCoordinator', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteDocumentRepository;
  let storage: FakeDocumentFileStorage;
  let scanner: FakeDocumentMalwareScanner;
  let config: DocumentsConfig;
  let coordinator: DocumentProcessingCoordinator;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout'] });
    jest.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteDocumentRepository(databaseProvider);
    storage = new FakeDocumentFileStorage();
    scanner = new FakeDocumentMalwareScanner();
    config = {
      privateStoragePath: undefined,
      supported_formats: [],
      max_file_size_bytes: 10 * 1024 * 1024,
      max_files_per_request: 1,
      max_documents_per_project: 25,
      max_project_storage_bytes: 100 * 1024 * 1024,
      maxPdfPages: 200,
      maxExtractedTextBytes: 16 * 1024 * 1024,
      processingTimeoutMs: 30_000,
      processingLeaseMs: 45_000,
      maxProcessingConcurrency: 2,
      maxProcessingAttempts: 3,
      malwareScannerHost: '127.0.0.1',
      malwareScannerPort: 3310,
      malwareScannerTimeoutMs: 10_000,
    };
    coordinator = createCoordinator();
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createCoordinator(): DocumentProcessingCoordinator {
    const normalizer = new DocumentTextNormalizer();

    return new DocumentProcessingCoordinator(
      repository,
      storage,
      scanner,
      new PlainTextDocumentTextExtractor(normalizer),
      new MarkdownDocumentTextExtractor(normalizer),
      new PdfJsDocumentTextExtractor(normalizer),
      config,
    );
  }

  function createDocument(
    content: string,
    overrides: Partial<NewDocumentRecord> = {},
  ) {
    const project =
      projects.list()[0] ??
      projects.create({
        title: 'Document processing',
        description: 'Safe extraction tests.',
      });
    const id =
      overrides.id ??
      `document-${repository.getProjectUsage(project.id).document_count + 1}`;
    const reference = overrides.file_reference ?? `originals/aa/${id}`;
    const bytes = Buffer.from(content, 'utf8');
    storage.files.set(reference, bytes);

    return repository.create({
      id,
      project_id: project.id,
      title: 'Source',
      original_filename: 'source.txt',
      file_reference: reference,
      format: 'plain_text',
      mime_type: 'text/plain',
      size_bytes: bytes.byteLength,
      source_hash: createHash('sha256').update(bytes).digest('hex'),
      upload_idempotency_key: `upload-${id}`,
      upload_request_fingerprint: createHash('sha256')
        .update(`request-${id}`)
        .digest('hex'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    });
  }

  it('scans, normalizes, and atomically marks matching source text ready', async () => {
    const created = createDocument(
      '\ufeffCafe\u0301\r\n\r\n\r\nA second paragraph.  ',
    );

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(created.project_id, created.id),
    ).toMatchObject({
      processing_status: 'ready',
      extracted_text: 'Café\n\nA second paragraph.',
      processed_source_hash: created.source_hash,
      processing_attempt_count: 1,
      processing_error_code: null,
      processing_lease_owner: null,
    });
    expect(storage.lastRead?.every((byte) => byte === 0)).toBe(true);
  });

  it('fails unsafe and mismatched stored sources without exposing extracted text', async () => {
    scanner.results = ['unsafe'];
    const unsafe = createDocument('Unsafe source');

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(unsafe.project_id, unsafe.id),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'unsafe',
      processing_error_retryable: false,
      extracted_text: null,
    });

    scanner.results = ['clean'];
    const mismatched = createDocument('Expected source');
    storage.files.set(
      mismatched.file_reference,
      Buffer.from('Changed stored source'),
    );

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(mismatched.project_id, mismatched.id),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'corrupted',
      processing_error_retryable: false,
      extracted_text: null,
    });
  });

  it('retries transient work three times before exposing a recoverable failure', async () => {
    scanner.results = [
      new DocumentMalwareScannerError(),
      new DocumentMalwareScannerError(),
      'clean',
    ];
    const recovered = createDocument('Recovered source');

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(recovered.project_id, recovered.id),
    ).toMatchObject({
      processing_status: 'ready',
      processing_attempt_count: 3,
    });

    scanner.calls = 0;
    scanner.results = [new DocumentMalwareScannerError()];
    const exhausted = createDocument('Unavailable scanner');

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(exhausted.project_id, exhausted.id),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'scanner_unavailable',
      processing_error_retryable: true,
      processing_attempt_count: 3,
    });
  });

  it('keeps extraction concurrency within the configured worker bound', async () => {
    scanner.delayMs = 5;
    const documents = Array.from({ length: 5 }, (_, index) =>
      createDocument(`Source ${index}`),
    );

    await coordinator.drain();

    expect(scanner.maximumActive).toBe(2);
    expect(
      documents.map(
        (document) =>
          repository.findByProjectAndId(document.project_id, document.id)
            ?.processing_status,
      ),
    ).toEqual(['ready', 'ready', 'ready', 'ready', 'ready']);
  });

  it('recovers an expired durable lease while stale ownership stays ineffective', async () => {
    const created = createDocument('Recoverable source');
    repository.claimProcessingLease({
      project_id: created.project_id,
      document_id: created.id,
      expected_generation: 1,
      lease_owner: 'dead-worker',
      claimed_at: '2026-07-31T10:00:00.000Z',
      lease_expires_at: '2026-07-31T10:00:01.000Z',
    });
    jest.setSystemTime(new Date('2026-07-31T10:00:02.000Z'));

    await coordinator.drain();

    const recovered = repository.findByProjectAndId(
      created.project_id,
      created.id,
    );
    expect(recovered).toMatchObject({
      processing_status: 'ready',
      processing_attempt_count: 2,
      processing_lease_owner: null,
    });
    expect(
      repository.failProcessing({
        project_id: created.project_id,
        document_id: created.id,
        expected_generation: 1,
        lease_owner: 'dead-worker',
        error_code: 'unknown',
        retryable: true,
        completed_at: '2026-07-31T10:00:03.000Z',
      }),
    ).toBeUndefined();
  });

  it('classifies unavailable storage after bounded automatic attempts', async () => {
    const created = createDocument('Stored source');
    storage.failReads = true;

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(created.project_id, created.id),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'storage_unavailable',
      processing_error_retryable: true,
      processing_attempt_count: 3,
    });
  });

  it('bounds unresponsive processing attempts with a recoverable deadline failure', async () => {
    config.processingTimeoutMs = 5;
    config.processingLeaseMs = 50;
    scanner.delayMs = 1_000;
    coordinator = createCoordinator();
    const created = createDocument('Slow source');

    await coordinator.drain();

    expect(
      repository.findByProjectAndId(created.project_id, created.id),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'processing_unavailable',
      processing_error_retryable: true,
      processing_attempt_count: 3,
    });
  });
});
