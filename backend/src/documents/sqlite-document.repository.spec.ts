import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import {
  DocumentIntegrityError,
  type NewDocumentRecord,
} from './document.types';
import { SqliteDocumentRepository } from './sqlite-document.repository';

const SOURCE_HASH = 'a'.repeat(64);
const OTHER_SOURCE_HASH = 'b'.repeat(64);

describe('SqliteDocumentRepository', () => {
  let temporaryDirectory: string;
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteDocumentRepository;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-documents-'));
    databaseProvider = new DatabaseProvider({
      databasePath: join(temporaryDirectory, 'documents.sqlite'),
    });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteDocumentRepository(databaseProvider);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function createProject(title = 'Document project') {
    return projects.create({
      title,
      description: `${title} description`,
    });
  }

  function documentInput(
    projectId: string,
    overrides: Partial<NewDocumentRecord> = {},
  ): NewDocumentRecord {
    return {
      id: 'document-a',
      project_id: projectId,
      title: 'Research notes',
      original_filename: 'research-notes.txt',
      file_reference: 'private/project/document-a/source',
      format: 'plain_text',
      mime_type: 'text/plain',
      size_bytes: 1_024,
      source_hash: SOURCE_HASH,
      upload_idempotency_key: 'upload-a',
      upload_request_fingerprint: '1'.repeat(64),
      created_at: '2026-07-30T10:00:00.000Z',
      updated_at: '2026-07-30T10:00:00.000Z',
      ...overrides,
    };
  }

  it('persists project-owned processing records and lists them deterministically', () => {
    const project = createProject();
    const otherProject = createProject('Other document project');
    const first = repository.create(documentInput(project.id));
    const tiedLater = repository.create(
      documentInput(project.id, {
        id: 'document-b',
        file_reference: 'private/project/document-b/source',
        upload_idempotency_key: 'upload-b',
        upload_request_fingerprint: '2'.repeat(64),
        created_at: '2026-07-30T11:00:00.000Z',
        updated_at: '2026-07-30T11:00:00.000Z',
      }),
    );
    const tiedEarlier = repository.create(
      documentInput(project.id, {
        id: 'document-aa',
        file_reference: 'private/project/document-aa/source',
        upload_idempotency_key: 'upload-aa',
        upload_request_fingerprint: '3'.repeat(64),
        created_at: '2026-07-30T11:00:00.000Z',
        updated_at: '2026-07-30T11:00:00.000Z',
      }),
    );
    repository.create(
      documentInput(otherProject.id, {
        id: 'other-document',
        file_reference: 'private/other/document/source',
        upload_idempotency_key: 'upload-a',
        upload_request_fingerprint: '4'.repeat(64),
      }),
    );

    expect(first).toEqual({
      ...documentInput(project.id),
      extracted_text: null,
      processed_source_hash: null,
      processing_status: 'processing',
      processing_error_code: null,
      processing_error_retryable: false,
      processing_generation: 1,
      processing_attempt_count: 0,
      processing_started_at: null,
      processing_completed_at: null,
      processing_lease_owner: null,
      processing_lease_expires_at: null,
    });
    expect(repository.findAllByProjectId(project.id)).toEqual([
      tiedEarlier,
      tiedLater,
      first,
    ]);
    expect(repository.findByProjectAndId(project.id, first.id)).toEqual(first);
    expect(
      repository.findByProjectAndId(otherProject.id, first.id),
    ).toBeUndefined();
    expect(repository.findProjectIdById(first.id)).toBe(project.id);
    expect(repository.getProjectUsage(project.id)).toEqual({
      document_count: 3,
      storage_bytes: 3_072,
    });
  });

  it('restores document records and deterministic ordering after reopening SQLite', () => {
    const project = createProject();
    const earlier = repository.create(documentInput(project.id));
    const later = repository.create(
      documentInput(project.id, {
        id: 'document-b',
        file_reference: 'private/project/document-b/source',
        upload_idempotency_key: 'upload-b',
        upload_request_fingerprint: '2'.repeat(64),
        created_at: '2026-07-30T11:00:00.000Z',
        updated_at: '2026-07-30T11:00:00.000Z',
      }),
    );

    databaseProvider.onModuleDestroy();
    databaseProvider = new DatabaseProvider({
      databasePath: join(temporaryDirectory, 'documents.sqlite'),
    });
    repository = new SqliteDocumentRepository(databaseProvider);

    expect(repository.findAllByProjectId(project.id)).toEqual([later, earlier]);
  });

  it('enforces project-scoped upload idempotency while allowing duplicate filenames', () => {
    const project = createProject();
    const otherProject = createProject('Other project');
    const existing = repository.create(documentInput(project.id));
    const duplicateFilename = repository.create(
      documentInput(project.id, {
        id: 'document-b',
        file_reference: 'private/project/document-b/source',
        upload_idempotency_key: 'upload-b',
        upload_request_fingerprint: '2'.repeat(64),
      }),
    );

    expect(duplicateFilename.original_filename).toBe(
      existing.original_filename,
    );
    expect(
      repository.findByProjectAndUploadIdempotencyKey(project.id, 'upload-a'),
    ).toEqual(existing);
    expect(() =>
      repository.create(
        documentInput(project.id, {
          id: 'document-conflict',
          file_reference: 'private/project/document-conflict/source',
          upload_request_fingerprint: '3'.repeat(64),
        }),
      ),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      repository.create(
        documentInput(project.id, {
          id: 'document-file-reference-conflict',
          upload_idempotency_key: 'upload-c',
          upload_request_fingerprint: '4'.repeat(64),
        }),
      ),
    ).toThrow(/UNIQUE constraint failed/);
    expect(
      repository.create(
        documentInput(otherProject.id, {
          id: 'other-document',
          file_reference: 'private/other/document/source',
          upload_request_fingerprint: '5'.repeat(64),
        }),
      ).upload_idempotency_key,
    ).toBe('upload-a');
  });

  it('claims, renews, releases, and recovers processing leases safely', () => {
    const project = createProject();
    repository.create(documentInput(project.id));

    const firstClaim = repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 1,
      lease_owner: 'worker-a',
      claimed_at: '2026-07-30T10:01:00.000Z',
      lease_expires_at: '2026-07-30T10:06:00.000Z',
    });

    expect(firstClaim).toMatchObject({
      processing_attempt_count: 1,
      processing_started_at: '2026-07-30T10:01:00.000Z',
      processing_lease_owner: 'worker-a',
      processing_lease_expires_at: '2026-07-30T10:06:00.000Z',
    });
    expect(
      repository.claimProcessingLease({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-b',
        claimed_at: '2026-07-30T10:02:00.000Z',
        lease_expires_at: '2026-07-30T10:07:00.000Z',
      }),
    ).toBeUndefined();

    expect(
      repository.renewProcessingLease({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        renewed_at: '2026-07-30T10:03:00.000Z',
        lease_expires_at: '2026-07-30T10:08:00.000Z',
      }),
    ).toMatchObject({
      processing_attempt_count: 1,
      processing_lease_expires_at: '2026-07-30T10:08:00.000Z',
    });
    expect(
      repository.releaseProcessingLease({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        released_at: '2026-07-30T10:04:00.000Z',
      }),
    ).toMatchObject({
      processing_attempt_count: 1,
      processing_lease_owner: null,
      processing_lease_expires_at: null,
    });

    const secondClaim = repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 1,
      lease_owner: 'worker-b',
      claimed_at: '2026-07-30T10:05:00.000Z',
      lease_expires_at: '2026-07-30T10:10:00.000Z',
    });

    expect(secondClaim).toMatchObject({
      processing_attempt_count: 2,
      processing_started_at: '2026-07-30T10:01:00.000Z',
      processing_lease_owner: 'worker-b',
    });
    expect(
      repository.completeProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        extracted_text: 'Stale content',
        processed_source_hash: SOURCE_HASH,
        completed_at: '2026-07-30T10:06:00.000Z',
      }),
    ).toBeUndefined();

    expect(
      repository.completeProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-b',
        extracted_text: 'Complete processed text.',
        processed_source_hash: SOURCE_HASH,
        completed_at: '2026-07-30T10:07:00.000Z',
      }),
    ).toMatchObject({
      extracted_text: 'Complete processed text.',
      processed_source_hash: SOURCE_HASH,
      processing_status: 'ready',
      processing_attempt_count: 2,
      processing_completed_at: '2026-07-30T10:07:00.000Z',
      processing_lease_owner: null,
    });
  });

  it('discovers unclaimed and expired durable jobs in stable queue order', () => {
    const project = createProject();
    repository.create(documentInput(project.id));
    repository.create(
      documentInput(project.id, {
        id: 'document-b',
        file_reference: 'private/project/document-b/source',
        upload_idempotency_key: 'upload-b',
        upload_request_fingerprint: '2'.repeat(64),
        created_at: '2026-07-30T10:00:01.000Z',
        updated_at: '2026-07-30T10:00:01.000Z',
      }),
    );
    repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 1,
      lease_owner: 'worker-a',
      claimed_at: '2026-07-30T10:01:00.000Z',
      lease_expires_at: '2026-07-30T10:02:00.000Z',
    });

    expect(
      repository
        .findProcessingCandidates('2026-07-30T10:01:30.000Z', 10)
        .map((document) => document.id),
    ).toEqual(['document-b']);
    expect(
      repository
        .findProcessingCandidates('2026-07-30T10:02:00.000Z', 1)
        .map((document) => document.id),
    ).toEqual(['document-b']);
    expect(
      repository
        .findProcessingCandidates('2026-07-30T10:02:00.000Z', 10)
        .map((document) => document.id),
    ).toEqual(['document-b', 'document-a']);
  });

  it('rejects expired completion and mismatched source content without a false-ready state', () => {
    const project = createProject();
    repository.create(documentInput(project.id));
    repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 1,
      lease_owner: 'worker-a',
      claimed_at: '2026-07-30T10:01:00.000Z',
      lease_expires_at: '2026-07-30T10:03:00.000Z',
    });

    expect(
      repository.completeProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        extracted_text: 'Late content',
        processed_source_hash: SOURCE_HASH,
        completed_at: '2026-07-30T10:03:00.000Z',
      }),
    ).toBeUndefined();
    expect(() =>
      repository.completeProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        extracted_text: 'Mismatched content',
        processed_source_hash: OTHER_SOURCE_HASH,
        completed_at: '2026-07-30T10:02:00.000Z',
      }),
    ).toThrow(/CHECK constraint failed/);
    expect(
      repository.findByProjectAndId(project.id, 'document-a'),
    ).toMatchObject({
      processing_status: 'processing',
      extracted_text: null,
      processed_source_hash: null,
      processing_lease_owner: 'worker-a',
    });
  });

  it('increments the generation for retryable failures and rejects stale workers', () => {
    const project = createProject();
    repository.create(documentInput(project.id));
    repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 1,
      lease_owner: 'worker-a',
      claimed_at: '2026-07-30T10:01:00.000Z',
      lease_expires_at: '2026-07-30T10:06:00.000Z',
    });

    expect(
      repository.failProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        error_code: 'scanner_unavailable',
        retryable: true,
        completed_at: '2026-07-30T10:02:00.000Z',
      }),
    ).toMatchObject({
      processing_status: 'failed',
      processing_error_code: 'scanner_unavailable',
      processing_error_retryable: true,
      processing_generation: 1,
      processing_attempt_count: 1,
    });
    expect(
      repository.queueProcessingRetry({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        queued_at: '2026-07-30T10:03:00.000Z',
      }),
    ).toMatchObject({
      processing_status: 'processing',
      processing_error_code: null,
      processing_generation: 2,
      processing_attempt_count: 0,
      processing_started_at: null,
    });
    expect(
      repository.completeProcessing({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 1,
        lease_owner: 'worker-a',
        extracted_text: 'Stale generation content',
        processed_source_hash: SOURCE_HASH,
        completed_at: '2026-07-30T10:04:00.000Z',
      }),
    ).toBeUndefined();

    repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 2,
      lease_owner: 'worker-b',
      claimed_at: '2026-07-30T10:04:00.000Z',
      lease_expires_at: '2026-07-30T10:09:00.000Z',
    });
    repository.failProcessing({
      project_id: project.id,
      document_id: 'document-a',
      expected_generation: 2,
      lease_owner: 'worker-b',
      error_code: 'unsafe',
      retryable: false,
      completed_at: '2026-07-30T10:05:00.000Z',
    });

    expect(
      repository.queueProcessingRetry({
        project_id: project.id,
        document_id: 'document-a',
        expected_generation: 2,
        queued_at: '2026-07-30T10:06:00.000Z',
      }),
    ).toBeUndefined();
  });

  it('enforces immutable source metadata and reports corrupt stored state safely', () => {
    const project = createProject();
    repository.create(documentInput(project.id));

    expect(() =>
      databaseProvider.connection
        .prepare('UPDATE documents SET source_hash = ? WHERE id = ?')
        .run(OTHER_SOURCE_HASH, 'document-a'),
    ).toThrow(/document source metadata is immutable/);

    databaseProvider.connection.exec('PRAGMA ignore_check_constraints = ON;');
    databaseProvider.connection
      .prepare(
        `
          UPDATE documents
          SET processing_lease_expires_at = ?
          WHERE id = ?
        `,
      )
      .run('not-a-timestamp', 'document-a');

    expect(() =>
      repository.findByProjectAndId(project.id, 'document-a'),
    ).toThrow(DocumentIntegrityError);
  });

  it('cascades documents when their owning project is removed', () => {
    const project = createProject();
    repository.create(documentInput(project.id));

    databaseProvider.connection
      .prepare('DELETE FROM projects WHERE id = ?')
      .run(project.id);

    expect(repository.findAllByProjectId(project.id)).toEqual([]);
  });
});
