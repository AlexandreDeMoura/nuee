import { DatabaseProvider } from '../database/database.provider';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import type { Project } from '../projects/project.types';
import type { FrozenContextV1 } from '@nuee/shared-types';
import { DiscussionContextIntegrityError } from './discussion.types';
import type {
  PersistedDiscussion,
  PersistedDiscussionMessage,
  VersionedPersistedDiscussion,
} from './discussion.types';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

describe('SqliteDiscussionRepository', () => {
  let databaseProvider: DatabaseProvider;
  let projects: SqliteProjectRepository;
  let repository: SqliteDiscussionRepository;

  beforeEach(() => {
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new SqliteProjectRepository(databaseProvider);
    repository = new SqliteDiscussionRepository(databaseProvider);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
  });

  function createProject(id: string): Project {
    const project: Project = {
      id,
      title: `Project ${id}`,
      description: `Description for ${id}`,
      created_at: '2026-07-27T09:00:00.000Z',
      updated_at: '2026-07-27T09:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    };

    return projects.create(project);
  }

  function discussion(
    projectId: string,
    id: string,
    timestamp = '2026-07-27T10:00:00.000Z',
  ): PersistedDiscussion {
    return {
      id,
      project_id: projectId,
      title: null,
      frozen_context: {
        project_description: {
          content: 'A frozen project description.',
          captured_at: timestamp,
        },
      },
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      deleted_at: null,
      context_version: null,
      expected_context_item_count: null,
      creation_idempotency_key: null,
      creation_request_fingerprint: null,
    };
  }

  function message(
    discussionId: string,
    id: string,
    requestId: string | null,
    createdAt = '2026-07-27T10:00:00.000Z',
  ): PersistedDiscussionMessage {
    return {
      id,
      discussion_id: discussionId,
      role: requestId === null ? 'assistant' : 'user',
      content:
        requestId === null
          ? 'A focused response.'
          : 'What should we decide first?',
      created_at: createdAt,
      status: requestId === null ? 'completed' : 'pending',
      request_id: requestId,
    };
  }

  function versionedDiscussion(
    projectId: string,
    id: string,
    timestamp = '2026-07-27T10:00:00.000Z',
  ): VersionedPersistedDiscussion {
    const frozenContext: FrozenContextV1 = {
      version: 1,
      items: [
        {
          id: `context-${id}-project`,
          source_kind: 'project_description',
          source_id: projectId,
          source_title: 'Project description',
          frozen_content: 'The immutable project description.',
          created_at: timestamp,
          display_order: 0,
        },
        {
          id: `context-${id}-bubble`,
          source_kind: 'bubble',
          source_id: 'bubble-a',
          source_title: 'Frozen bubble',
          frozen_content: 'The immutable bubble content.',
          created_at: timestamp,
          display_order: 1,
        },
      ],
    };

    return {
      id,
      project_id: projectId,
      title: null,
      frozen_context: frozenContext,
      created_at: timestamp,
      updated_at: timestamp,
      last_activity_at: timestamp,
      deleted_at: null,
      context_version: 1,
      expected_context_item_count: frozenContext.items.length,
      creation_idempotency_key: `create-${id}`,
      creation_request_fingerprint: 'a'.repeat(64),
    };
  }

  it('atomically creates a discussion with its first message and frozen context', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-a', 'request-a');

    expect(repository.createWithFirstMessage(record, firstMessage)).toEqual(
      record,
    );
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual(
      record,
    );
    expect(repository.findAllMessages(project.id, record.id)).toEqual([
      firstMessage,
    ]);
  });

  it('rolls back the discussion when its first message cannot be inserted', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const invalidMessage = {
      ...message(record.id, 'message-a', 'request-a'),
      content: ' ',
    };

    expect(() =>
      repository.createWithFirstMessage(record, invalidMessage),
    ).toThrow();
    expect(repository.findAllByProjectId(project.id)).toEqual([]);
  });

  it('atomically persists complete versioned context items as the read authority', () => {
    const project = createProject('project-a');
    const record = versionedDiscussion(project.id, 'discussion-versioned');
    const firstMessage = message(record.id, 'message-a', 'request-a');

    expect(repository.createWithFirstMessage(record, firstMessage)).toEqual(
      record,
    );
    databaseProvider.connection
      .prepare(
        `
          UPDATE discussions
          SET frozen_context = json_object('legacy_column_is_not_authority', 1)
          WHERE id = ?
        `,
      )
      .run(record.id);

    expect(repository.findByProjectAndId(project.id, record.id)).toEqual(
      record,
    );
    expect(
      databaseProvider.connection
        .prepare(
          `
            SELECT
              context_version,
              expected_context_item_count,
              creation_idempotency_key,
              creation_request_fingerprint
            FROM discussions
            WHERE id = ?
          `,
        )
        .get(record.id),
    ).toEqual({
      context_version: 1,
      expected_context_item_count: 2,
      creation_idempotency_key: record.creation_idempotency_key,
      creation_request_fingerprint: record.creation_request_fingerprint,
    });
  });

  it('rolls back versioned context rows when the first message is invalid', () => {
    const project = createProject('project-a');
    const record = versionedDiscussion(project.id, 'discussion-versioned');
    const invalidMessage = {
      ...message(record.id, 'message-a', 'request-a'),
      content: ' ',
    };

    expect(() =>
      repository.createWithFirstMessage(record, invalidMessage),
    ).toThrow();
    expect(repository.findAllByProjectId(project.id)).toEqual([]);
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM discussion_context_items')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('finds a versioned discussion by a project-scoped creation idempotency key', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const first = versionedDiscussion(firstProject.id, 'discussion-a');
    const second = {
      ...versionedDiscussion(secondProject.id, 'discussion-b'),
      creation_idempotency_key: first.creation_idempotency_key,
    };
    const duplicateInFirstProject = {
      ...versionedDiscussion(firstProject.id, 'discussion-c'),
      creation_idempotency_key: first.creation_idempotency_key,
    };

    repository.createWithFirstMessage(
      first,
      message(first.id, 'message-a', 'request-a'),
    );
    repository.createWithFirstMessage(
      second,
      message(second.id, 'message-b', 'request-b'),
    );
    expect(() =>
      repository.createWithFirstMessage(
        duplicateInFirstProject,
        message(duplicateInFirstProject.id, 'message-c', 'request-c'),
      ),
    ).toThrow();

    expect(
      repository.findByProjectAndCreationIdempotencyKey(
        firstProject.id,
        first.creation_idempotency_key,
      ),
    ).toEqual(first);
    expect(
      repository.findByProjectAndCreationIdempotencyKey(
        secondProject.id,
        first.creation_idempotency_key,
      ),
    ).toEqual(second);
  });

  it('rejects incomplete or duplicate versioned context and rolls back creation', () => {
    const project = createProject('project-a');
    const complete = versionedDiscussion(project.id, 'discussion-a');
    const duplicateSource = {
      ...complete.frozen_context.items[1],
      id: 'context-duplicate',
      display_order: 2,
    };
    const invalid: PersistedDiscussion = {
      ...complete,
      frozen_context: {
        version: 1,
        items: [...complete.frozen_context.items, duplicateSource],
      },
      expected_context_item_count: 3,
    };

    expect(() =>
      repository.createWithFirstMessage(
        invalid,
        message(invalid.id, 'message-a', 'request-a'),
      ),
    ).toThrow(DiscussionContextIntegrityError);
    expect(repository.findAllByProjectId(project.id)).toEqual([]);
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM discussion_context_items')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('enforces display-order, source, and project-description uniqueness in SQLite', () => {
    const project = createProject('project-a');
    const record = versionedDiscussion(project.id, 'discussion-a');
    repository.createWithFirstMessage(
      record,
      message(record.id, 'message-a', 'request-a'),
    );
    const insert = databaseProvider.connection.prepare(
      `
        INSERT INTO discussion_context_items (
          id,
          discussion_id,
          source_kind,
          source_id,
          source_title,
          frozen_content,
          created_at,
          display_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    expect(() =>
      insert.run(
        'duplicate-order',
        record.id,
        'document',
        'document-a',
        'Document',
        'Document content',
        record.created_at,
        1,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        'duplicate-source',
        record.id,
        'bubble',
        'bubble-a',
        'Bubble again',
        'Duplicate bubble content',
        record.created_at,
        2,
      ),
    ).toThrow();
    expect(() =>
      insert.run(
        'duplicate-project-description',
        record.id,
        'project_description',
        'another-project',
        'Project description again',
        '',
        record.created_at,
        2,
      ),
    ).toThrow();
  });

  it('detects missing and malformed authoritative context rows on reads', () => {
    const project = createProject('project-a');
    const missing = versionedDiscussion(project.id, 'discussion-missing');
    const malformed = versionedDiscussion(
      project.id,
      'discussion-malformed',
      '2026-07-27T11:00:00.000Z',
    );

    repository.createWithFirstMessage(
      missing,
      message(missing.id, 'message-missing', 'request-missing'),
    );
    repository.createWithFirstMessage(
      malformed,
      message(malformed.id, 'message-malformed', 'request-malformed'),
    );
    databaseProvider.connection
      .prepare(
        `
          DELETE FROM discussion_context_items
          WHERE discussion_id = ? AND display_order = 1
        `,
      )
      .run(missing.id);
    databaseProvider.connection
      .prepare(
        `
          UPDATE discussion_context_items
          SET created_at = 'not-a-timestamp'
          WHERE discussion_id = ? AND display_order = 1
        `,
      )
      .run(malformed.id);

    expect(() => repository.findByProjectAndId(project.id, missing.id)).toThrow(
      DiscussionContextIntegrityError,
    );
    expect(() =>
      repository.findByProjectAndId(project.id, malformed.id),
    ).toThrow(DiscussionContextIntegrityError);
  });

  it('keeps snapshot rows independent from live source foreign keys', () => {
    const foreignKeys = databaseProvider.connection
      .prepare('PRAGMA foreign_key_list(discussion_context_items)')
      .all();

    expect(foreignKeys).toEqual([
      expect.objectContaining({
        table: 'discussions',
        from: 'discussion_id',
        to: 'id',
        on_delete: 'CASCADE',
      }),
    ]);
  });

  it('lists only the requested project by latest activity with stable ties', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const oldest = discussion(
      firstProject.id,
      'discussion-oldest',
      '2026-07-27T10:00:00.000Z',
    );
    const tiedA = discussion(
      firstProject.id,
      'discussion-a',
      '2026-07-27T11:00:00.000Z',
    );
    const tiedB = discussion(
      firstProject.id,
      'discussion-b',
      '2026-07-27T11:00:00.000Z',
    );
    const otherProject = discussion(
      secondProject.id,
      'discussion-other',
      '2026-07-27T12:00:00.000Z',
    );

    for (const record of [oldest, tiedB, tiedA, otherProject]) {
      repository.createWithFirstMessage(
        record,
        message(record.id, `message-${record.id}`, `request-${record.id}`),
      );
    }

    expect(
      repository.findAllByProjectId(firstProject.id).map((record) => record.id),
    ).toEqual([tiedA.id, tiedB.id, oldest.id]);
  });

  it('appends messages chronologically and advances content activity', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-user', 'request-a');
    const assistantMessage = message(
      record.id,
      'message-assistant',
      null,
      '2026-07-27T10:00:01.000Z',
    );

    repository.createWithFirstMessage(record, firstMessage);

    expect(
      repository.appendMessage(
        project.id,
        assistantMessage,
        assistantMessage.created_at,
      ),
    ).toEqual(assistantMessage);
    expect(repository.findAllMessages(project.id, record.id)).toEqual([
      firstMessage,
      assistantMessage,
    ]);
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual({
      ...record,
      updated_at: assistantMessage.created_at,
      last_activity_at: assistantMessage.created_at,
    });
  });

  it('enforces request idempotency within a discussion', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-a', 'request-a');
    const duplicateRequest = message(
      record.id,
      'message-b',
      firstMessage.request_id,
      '2026-07-27T10:00:01.000Z',
    );

    repository.createWithFirstMessage(record, firstMessage);

    expect(() =>
      repository.appendMessage(
        project.id,
        duplicateRequest,
        duplicateRequest.created_at,
      ),
    ).toThrow();
    expect(repository.findAllMessages(project.id, record.id)).toEqual([
      firstMessage,
    ]);
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual(
      record,
    );
    expect(
      repository.findMessageByRequestId(project.id, record.id, 'request-a'),
    ).toEqual(firstMessage);
  });

  it('updates generation status without treating failure as activity', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-a', 'request-a');
    const failedAt = '2026-07-27T10:00:02.000Z';

    repository.createWithFirstMessage(record, firstMessage);

    expect(
      repository.updateMessageStatus(
        project.id,
        record.id,
        firstMessage.id,
        'failed',
        failedAt,
      ),
    ).toEqual({
      ...firstMessage,
      status: 'failed',
    });
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual({
      ...record,
      updated_at: failedAt,
    });
  });

  it('atomically completes a generation at most once', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-user', 'request-a');
    const assistantMessage = message(
      record.id,
      'message-assistant',
      null,
      '2026-07-27T10:00:02.000Z',
    );

    repository.createWithFirstMessage(record, firstMessage);

    expect(
      repository.completeMessageGeneration(
        project.id,
        record.id,
        firstMessage.id,
        assistantMessage,
        assistantMessage.created_at,
      ),
    ).toEqual(assistantMessage);
    expect(
      repository.completeMessageGeneration(
        project.id,
        record.id,
        firstMessage.id,
        {
          ...assistantMessage,
          id: 'message-duplicate-assistant',
        },
        assistantMessage.created_at,
      ),
    ).toBe(undefined);
    expect(repository.findAllMessages(project.id, record.id)).toEqual([
      { ...firstMessage, status: 'completed' },
      assistantMessage,
    ]);
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual({
      ...record,
      updated_at: assistantMessage.created_at,
      last_activity_at: assistantMessage.created_at,
    });
  });

  it('keeps open activity separate from content updated_at', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    const openedAt = '2026-07-27T10:05:00.000Z';

    repository.createWithFirstMessage(
      record,
      message(record.id, 'message-a', 'request-a'),
    );

    expect(repository.updateActivity(project.id, record.id, openedAt)).toEqual({
      ...record,
      last_activity_at: openedAt,
    });
  });

  it('sets a generated title only while the discussion is untitled', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');
    repository.createWithFirstMessage(
      record,
      message(record.id, 'message-a', 'request-a'),
    );

    expect(
      repository.updateTitle(
        project.id,
        record.id,
        'First generated title',
        '2026-07-27T10:05:00.000Z',
      ),
    ).toEqual({
      ...record,
      title: 'First generated title',
      updated_at: '2026-07-27T10:05:00.000Z',
    });
    expect(
      repository.updateTitle(
        project.id,
        record.id,
        'Replacement title',
        '2026-07-27T10:06:00.000Z',
      ),
    ).toBe(undefined);
    expect(repository.findByProjectAndId(project.id, record.id)).toEqual({
      ...record,
      title: 'First generated title',
      updated_at: '2026-07-27T10:05:00.000Z',
    });
  });

  it('soft deletes project-scoped discussions and makes messages inaccessible', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const record = versionedDiscussion(firstProject.id, 'discussion-a');
    const firstMessage = message(record.id, 'message-a', 'request-a');

    repository.createWithFirstMessage(record, firstMessage);

    expect(
      repository.softDelete(
        secondProject.id,
        record.id,
        '2026-07-27T10:10:00.000Z',
      ),
    ).toBe(false);
    expect(
      repository.softDelete(
        firstProject.id,
        record.id,
        '2026-07-27T10:10:00.000Z',
      ),
    ).toBe(true);
    expect(repository.findByProjectAndId(firstProject.id, record.id)).toBe(
      undefined,
    );
    expect(repository.findAllMessages(firstProject.id, record.id)).toEqual([]);
    expect(
      repository.appendMessage(
        firstProject.id,
        message(record.id, 'message-b', null),
        '2026-07-27T10:11:00.000Z',
      ),
    ).toBe(undefined);
    expect(
      databaseProvider.connection
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM discussion_context_items
            WHERE discussion_id = ?
          `,
        )
        .get(record.id),
    ).toEqual({ count: record.expected_context_item_count });
  });

  it('cascades hard project deletion through discussions, messages, and context', () => {
    const project = createProject('project-a');
    const record = versionedDiscussion(project.id, 'discussion-a');

    repository.createWithFirstMessage(
      record,
      message(record.id, 'message-a', 'request-a'),
    );
    databaseProvider.connection
      .prepare('DELETE FROM projects WHERE id = ?')
      .run(project.id);

    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM discussions')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM discussion_messages')
        .get(),
    ).toEqual({ count: 0 });
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM discussion_context_items')
        .get(),
    ).toEqual({ count: 0 });
  });
});
