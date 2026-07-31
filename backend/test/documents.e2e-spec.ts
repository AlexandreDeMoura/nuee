import { createHash } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  DiscussionDetails,
  DocumentDetail,
  DocumentListResponse,
  DocumentSummary,
  DocumentUploadPolicyResponse,
  FrozenContextV1,
  Project,
} from '@nuee/shared-types';
import { AppModule } from './../src/app.module';
import { DatabaseProvider } from './../src/database/database.provider';
import { DocumentProcessingCoordinator } from './../src/documents/document-processing.coordinator';
import {
  DOCUMENT_REPOSITORY,
  type DocumentRepository,
} from './../src/documents/document.types';
import {
  markdownDocumentFixture,
  noTextPdfDocumentFixture,
  plainTextDocumentFixture,
  textPdfDocumentFixture,
  unsafeTextDocumentFixture,
} from './fixtures/document-files';

describe('Document library journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-document-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'documents.sqlite');
  const privateStoragePath = join(temporaryDirectory, 'private-documents');
  const previousDatabasePath = process.env.PROJECT_DATABASE_PATH;
  const previousPrivateStoragePath = process.env.DOCUMENT_PRIVATE_STORAGE_PATH;
  const previousMaxFileSize = process.env.DOCUMENT_MAX_FILE_SIZE_BYTES;
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.PROJECT_DATABASE_PATH = databasePath;
    process.env.DOCUMENT_PRIVATE_STORAGE_PATH = privateStoragePath;
    process.env.DOCUMENT_MAX_FILE_SIZE_BYTES = '2048';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    restoreEnvironment('PROJECT_DATABASE_PATH', previousDatabasePath);
    restoreEnvironment(
      'DOCUMENT_PRIVATE_STORAGE_PATH',
      previousPrivateStoragePath,
    );
    restoreEnvironment('DOCUMENT_MAX_FILE_SIZE_BYTES', previousMaxFileSize);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  async function createProject(title: string): Promise<Project> {
    const response = await request(app.getHttpServer())
      .post('/projects')
      .send({
        title,
        description: `Description for ${title}.`,
      })
      .expect(201);

    return response.body as Project;
  }

  it('publishes the configured upload policy and stable multipart errors', async () => {
    const policyResponse = await request(app.getHttpServer())
      .get('/document-upload-policy')
      .expect(200);
    const policy = policyResponse.body as DocumentUploadPolicyResponse;

    expect(policy).toMatchObject({
      max_file_size_bytes: 2048,
      max_files_per_request: 1,
      max_documents_per_project: 25,
      max_project_storage_bytes: 100 * 1024 * 1024,
    });
    expect(policy.supported_formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'plain_text',
          extensions: ['.txt'],
        }),
        expect.objectContaining({
          category: 'markdown',
          extensions: ['.md'],
        }),
        expect.objectContaining({
          category: 'pdf',
          extensions: ['.pdf'],
        }),
      ]),
    );

    const project = await createProject('Upload validation');

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'missing-file')
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          field_errors: {
            file: 'A valid document filename is required.',
          },
        });
      });

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'oversized-file')
      .attach('file', Buffer.alloc(2049, 'a'), {
        filename: 'oversized.txt',
        contentType: 'text/plain',
      })
      .expect(413)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DOCUMENT_UPLOAD_LIMIT_EXCEEDED',
          reason: 'file_too_large',
          max_file_size_bytes: 2048,
        });
      });

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'two-files')
      .attach('file', Buffer.from('first'), {
        filename: 'first.txt',
        contentType: 'text/plain',
      })
      .attach('file', Buffer.from('second'), {
        filename: 'second.txt',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          reason: 'multipart_too_many_files',
        });
      });

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'extra-field')
      .field('unexpected', 'value')
      .attach('file', Buffer.from('only'), {
        filename: 'only.txt',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          reason: 'multipart_too_many_fields',
        });
      });

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'wrong-field-name')
      .attach('document', Buffer.from('only'), {
        filename: 'only.txt',
        contentType: 'text/plain',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
          reason: 'multipart_unexpected_field',
          field_errors: {
            file: 'Send the document in a field named "file".',
          },
        });
      });
  });

  it('processes supported fixtures independently and rejects invalid sources before ready state', async () => {
    const project = await createProject('Format fixtures');
    const uploads = [
      {
        bytes: plainTextDocumentFixture,
        filename: 'notes.txt',
        contentType: 'text/plain',
        idempotencyKey: 'fixture-txt',
        expectedFormat: 'plain_text',
        expectedText: 'First paragraph.\n\nSecond paragraph.',
      },
      {
        bytes: markdownDocumentFixture,
        filename: 'finding.md',
        contentType: 'text/markdown',
        idempotencyKey: 'fixture-markdown',
        expectedFormat: 'markdown',
        expectedText: markdownDocumentFixture.toString('utf8'),
      },
      {
        bytes: textPdfDocumentFixture([
          'Frozen context stays stable.',
          'Second line of the fixture.',
        ]),
        filename: 'report.pdf',
        contentType: 'application/pdf',
        idempotencyKey: 'fixture-pdf',
        expectedFormat: 'pdf',
        expectedText:
          'Frozen context stays stable.\nSecond line of the fixture.',
      },
    ] as const;
    const accepted: DocumentSummary[] = [];

    for (const fixture of uploads) {
      const response = await request(app.getHttpServer())
        .post(`/projects/${project.id}/documents`)
        .field('idempotency_key', fixture.idempotencyKey)
        .attach('file', fixture.bytes, {
          filename: fixture.filename,
          contentType: fixture.contentType,
        })
        .expect(201);
      accepted.push(response.body as DocumentSummary);
      expect(response.body).toMatchObject({
        format: fixture.expectedFormat,
        processing_status: 'processing',
      });
    }

    const noTextResponse = await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'fixture-no-text')
      .attach('file', noTextPdfDocumentFixture(), {
        filename: 'scanned.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const noText = noTextResponse.body as DocumentSummary;

    const unsafeResponse = await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'fixture-unsafe')
      .attach('file', unsafeTextDocumentFixture, {
        filename: 'unsafe.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    const unsafe = unsafeResponse.body as DocumentSummary;

    await app.get(DocumentProcessingCoordinator).drain();

    for (const [index, fixture] of uploads.entries()) {
      await request(app.getHttpServer())
        .get(`/projects/${project.id}/documents/${accepted[index]?.id}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            processing_status: 'ready',
            extracted_text: fixture.expectedText,
          });
        });
    }

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents/${noText.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          processing_status: 'failed',
          processing_error_code: 'no_text',
          extracted_text: null,
        });
      });
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents/${unsafe.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          processing_status: 'failed',
          processing_error_code: 'unsafe',
          extracted_text: null,
        });
      });

    const rejectedFixtures = [
      {
        bytes: Buffer.alloc(0),
        filename: 'empty.txt',
        contentType: 'text/plain',
        reason: 'empty_file',
      },
      {
        bytes: Buffer.from([0x61, 0, 0x62]),
        filename: 'binary.txt',
        contentType: 'text/plain',
        reason: 'binary_content',
      },
      {
        bytes: Buffer.from('not a pdf'),
        filename: 'mismatch.txt',
        contentType: 'application/pdf',
        reason: 'mime_type_mismatch',
      },
      {
        bytes: Buffer.from('%PDF-1.4\nnot a document'),
        filename: 'corrupted.pdf',
        contentType: 'application/pdf',
        reason: 'invalid_pdf',
      },
      {
        bytes: Buffer.from('unsupported'),
        filename: 'unsupported.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        reason: 'unsupported_extension',
      },
    ] as const;

    for (const [index, fixture] of rejectedFixtures.entries()) {
      await request(app.getHttpServer())
        .post(`/projects/${project.id}/documents`)
        .field('idempotency_key', `rejected-${index}`)
        .attach('file', fixture.bytes, {
          filename: fixture.filename,
          contentType: fixture.contentType,
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body).toMatchObject({
            code: 'DOCUMENT_UPLOAD_VALIDATION_FAILED',
            reason: fixture.reason,
          });
        });
    }

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toHaveLength(uploads.length + 2);
      });
  });

  it('uploads, lists, inspects, scopes, and freezes a ready document', async () => {
    const project = await createProject('Document owner');
    const otherProject = await createProject('Other document owner');
    const sourceText = '# Finding\n\nThe launch remains reversible.';

    const uploadResponse = await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'upload-finding')
      .attach('file', Buffer.from(sourceText), {
        filename: 'Research Finding.md',
        contentType: 'text/markdown',
      })
      .expect(201);
    const uploaded = uploadResponse.body as DocumentSummary;

    expect(uploaded).toMatchObject({
      project_id: project.id,
      title: 'Research Finding',
      original_filename: 'Research Finding.md',
      format: 'markdown',
      mime_type: 'text/markdown',
      processing_status: 'processing',
    });
    expect(uploaded).not.toHaveProperty('extracted_text');

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .field('idempotency_key', 'upload-finding')
      .attach('file', Buffer.from(sourceText), {
        filename: 'Research Finding.md',
        contentType: 'text/markdown',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: uploaded.id });
      });

    await app.get(DocumentProcessingCoordinator).drain();

    const listResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents`)
      .expect(200);
    const list = listResponse.body as DocumentListResponse;
    expect(list).toEqual([
      expect.objectContaining({
        id: uploaded.id,
        processing_status: 'ready',
      }),
    ]);
    expect(list[0]).not.toHaveProperty('extracted_text');
    expect(list[0]).not.toHaveProperty('file_reference');

    await request(app.getHttpServer())
      .get(`/projects/${otherProject.id}/documents`)
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .get(`/projects/${otherProject.id}/documents/${uploaded.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'DOCUMENT_NOT_FOUND' });
      });

    const detailResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents/${uploaded.id}`)
      .expect(200);
    const detail = detailResponse.body as DocumentDetail;
    expect(detail).toMatchObject({
      id: uploaded.id,
      processing_status: 'ready',
      extracted_text: sourceText,
    });
    const unchangedUpdatedAt = detail.updated_at;

    const discussionResponse = await request(app.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'Use the selected document.',
        idempotency_key: 'discussion-with-document',
        bubble_ids: [],
        document_ids: [uploaded.id],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const frozenContext = discussion.frozen_context as FrozenContextV1;

    expect(frozenContext.items).toEqual([
      expect.objectContaining({
        source_kind: 'project_description',
        source_id: project.id,
        frozen_content: project.description,
        display_order: 0,
      }),
      expect.objectContaining({
        source_kind: 'document',
        source_id: uploaded.id,
        source_title: 'Research Finding',
        frozen_content: sourceText,
        display_order: 1,
      }),
    ]);

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents/${uploaded.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          processing_status: 'ready',
          extracted_text: sourceText,
          updated_at: unchangedUpdatedAt,
        });
      });

    app
      .get(DatabaseProvider)
      .connection.prepare(
        `
          UPDATE documents
          SET title = ?, extracted_text = ?, updated_at = ?
          WHERE project_id = ? AND id = ?
        `,
      )
      .run(
        'Changed live title',
        'Changed live content.',
        '2026-07-31T12:00:00.000Z',
        project.id,
        uploaded.id,
      );

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect((body as DiscussionDetails).frozen_context).toEqual(
          discussion.frozen_context,
        );
      });

    app
      .get(DatabaseProvider)
      .connection.prepare(
        'DELETE FROM documents WHERE project_id = ? AND id = ?',
      )
      .run(project.id, uploaded.id);

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/documents/${uploaded.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect((body as DiscussionDetails).frozen_context).toEqual(
          discussion.frozen_context,
        );
      });
  });

  it('retries only recoverable failures without creating another record', async () => {
    const project = await createProject('Retry owner');
    const repository = app.get<DocumentRepository>(DOCUMENT_REPOSITORY);
    const sourceText = 'Recoverable source.';
    const sourceHash = createHash('sha256').update(sourceText).digest('hex');

    repository.create({
      id: 'recoverable-document',
      project_id: project.id,
      title: 'Recoverable source',
      original_filename: 'recoverable.txt',
      file_reference: 'originals/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      format: 'plain_text',
      mime_type: 'text/plain',
      size_bytes: Buffer.byteLength(sourceText),
      source_hash: sourceHash,
      upload_idempotency_key: 'recoverable-upload',
      upload_request_fingerprint: createHash('sha256')
        .update('recoverable-upload-request')
        .digest('hex'),
      created_at: '2026-07-31T10:00:00.000Z',
      updated_at: '2026-07-31T10:00:00.000Z',
    });
    repository.claimProcessingLease({
      project_id: project.id,
      document_id: 'recoverable-document',
      expected_generation: 1,
      lease_owner: 'failed-worker',
      claimed_at: '2026-07-31T10:01:00.000Z',
      lease_expires_at: '2026-07-31T10:06:00.000Z',
    });
    repository.failProcessing({
      project_id: project.id,
      document_id: 'recoverable-document',
      expected_generation: 1,
      lease_owner: 'failed-worker',
      error_code: 'storage_unavailable',
      retryable: true,
      completed_at: '2026-07-31T10:02:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents/recoverable-document/retry`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: 'recoverable-document',
          processing_status: 'processing',
          processing_error_code: null,
          can_retry: false,
        });
      });

    expect(
      repository
        .findAllByProjectId(project.id)
        .filter(({ id }) => id === 'recoverable-document'),
    ).toHaveLength(1);
  });
});

function restoreEnvironment(
  key:
    | 'PROJECT_DATABASE_PATH'
    | 'DOCUMENT_PRIVATE_STORAGE_PATH'
    | 'DOCUMENT_MAX_FILE_SIZE_BYTES',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
