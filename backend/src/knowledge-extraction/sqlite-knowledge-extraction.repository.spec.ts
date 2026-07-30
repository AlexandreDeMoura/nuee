import { DatabaseProvider } from '../database/database.provider';
import type { PersistedDiscussion } from '../discussions/discussion.types';
import { SqliteDiscussionRepository } from '../discussions/sqlite-discussion.repository';
import type { Project } from '../projects/project.types';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import {
  KnowledgeExtractionIntegrityError,
  type KnowledgeExtractionAttempt,
} from './knowledge-extraction.types';
import { SqliteKnowledgeExtractionRepository } from './sqlite-knowledge-extraction.repository';

describe('SqliteKnowledgeExtractionRepository', () => {
  let databaseProvider: DatabaseProvider;
  let projects: SqliteProjectRepository;
  let discussions: SqliteDiscussionRepository;
  let repository: SqliteKnowledgeExtractionRepository;

  beforeEach(() => {
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new SqliteProjectRepository(databaseProvider);
    discussions = new SqliteDiscussionRepository(databaseProvider);
    repository = new SqliteKnowledgeExtractionRepository(databaseProvider);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
  });

  function createProject(id: string): Project {
    return projects.create({
      id,
      title: `Project ${id}`,
      description: `Description for ${id}`,
      created_at: '2026-07-30T08:00:00.000Z',
      updated_at: '2026-07-30T08:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
  }

  function createDiscussion(
    projectId: string,
    id: string,
  ): PersistedDiscussion {
    const discussion: PersistedDiscussion = {
      id,
      project_id: projectId,
      title: 'Persisted source',
      frozen_context: {},
      created_at: '2026-07-30T09:00:00.000Z',
      updated_at: '2026-07-30T09:00:00.000Z',
      last_activity_at: '2026-07-30T09:00:00.000Z',
      deleted_at: null,
      context_version: null,
      expected_context_item_count: null,
      creation_idempotency_key: null,
      creation_request_fingerprint: null,
    };

    discussions.createWithFirstMessage(discussion, {
      id: `message-${id}`,
      discussion_id: id,
      role: 'user',
      content: 'Persist this source.',
      created_at: discussion.created_at,
      status: 'pending',
      request_id: `request-${id}`,
    });
    return discussion;
  }

  function attempt(
    projectId: string,
    discussionId: string,
    id = 'extraction-a',
  ): KnowledgeExtractionAttempt {
    const timestamp = '2026-07-30T10:00:00.000Z';

    return {
      id,
      project_id: projectId,
      discussion_id: discussionId,
      idempotency_key: 'extract-once',
      request_fingerprint: 'a'.repeat(64),
      source_snapshot: {
        version: 1,
        project_id: projectId,
        discussion_id: discussionId,
        discussion_title: 'Persisted source',
        requested_at: timestamp,
        message_selection_kind: 'selected',
        messages: [
          {
            source_kind: 'message',
            source_id: `message-${discussionId}`,
            role: 'user',
            content: 'Persist this source.',
            created_at: '2026-07-30T09:00:00.000Z',
            discussion_order: 0,
          },
        ],
        frozen_context_items: [],
      },
      proposal: null,
      status: 'generating',
      resolution_fingerprint: null,
      resolution_kind: null,
      resulting_bubble_id: null,
      retry_count: 0,
      created_at: timestamp,
      updated_at: timestamp,
      expires_at: '2026-07-31T10:00:00.000Z',
    };
  }

  it('persists and scopes the canonical source snapshot', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const sourceDiscussion = createDiscussion(firstProject.id, 'discussion-a');
    const record = attempt(firstProject.id, sourceDiscussion.id);

    expect(repository.create(record)).toEqual(record);
    expect(
      repository.findByProjectDiscussionAndId(
        firstProject.id,
        sourceDiscussion.id,
        record.id,
      ),
    ).toEqual(record);
    expect(
      repository.findByProjectDiscussionAndIdempotencyKey(
        firstProject.id,
        sourceDiscussion.id,
        record.idempotency_key,
      ),
    ).toEqual(record);
    expect(
      repository.findByProjectDiscussionAndId(
        secondProject.id,
        sourceDiscussion.id,
        record.id,
      ),
    ).toBeUndefined();
  });

  it('enforces idempotency identity, discussion scope, and source immutability', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const sourceDiscussion = createDiscussion(firstProject.id, 'discussion-a');
    const record = attempt(firstProject.id, sourceDiscussion.id);

    repository.create(record);

    expect(() =>
      repository.create({
        ...record,
        id: 'extraction-duplicate',
      }),
    ).toThrow();
    expect(() =>
      repository.create({
        ...record,
        id: 'extraction-cross-scope',
        project_id: secondProject.id,
        source_snapshot: {
          ...record.source_snapshot,
          project_id: secondProject.id,
        },
      }),
    ).toThrow(
      /knowledge extraction discussion must be available in its project/,
    );
    expect(() =>
      databaseProvider.connection
        .prepare(
          `
            UPDATE knowledge_extraction_attempts
            SET source_snapshot = source_snapshot
            WHERE id = ?
          `,
        )
        .run(record.id),
    ).toThrow(/knowledge extraction source snapshot is immutable/);
  });

  it('turns corrupt persisted snapshots into a controlled repository error', () => {
    const project = createProject('project-a');
    const sourceDiscussion = createDiscussion(project.id, 'discussion-a');
    const record = attempt(project.id, sourceDiscussion.id);

    repository.create(record);
    databaseProvider.connection.exec(`
      DROP TRIGGER knowledge_extraction_attempts_source_immutable_guard;
      PRAGMA ignore_check_constraints = ON;
    `);
    databaseProvider.connection
      .prepare(
        `
          UPDATE knowledge_extraction_attempts
          SET source_snapshot = json_set(
            source_snapshot,
            '$.messages[0].content',
            ' '
          )
          WHERE id = ?
        `,
      )
      .run(record.id);
    databaseProvider.connection.exec('PRAGMA ignore_check_constraints = OFF;');

    expect(() =>
      repository.findByProjectDiscussionAndId(
        project.id,
        sourceDiscussion.id,
        record.id,
      ),
    ).toThrow(KnowledgeExtractionIntegrityError);
  });
});
