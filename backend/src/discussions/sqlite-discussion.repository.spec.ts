import { DatabaseProvider } from '../database/database.provider';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import type { Project } from '../projects/project.types';
import type {
  PersistedDiscussion,
  PersistedDiscussionMessage,
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

  it('soft deletes project-scoped discussions and makes messages inaccessible', () => {
    const firstProject = createProject('project-a');
    const secondProject = createProject('project-b');
    const record = discussion(firstProject.id, 'discussion-a');
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
  });

  it('cascades hard project deletion through discussions and messages', () => {
    const project = createProject('project-a');
    const record = discussion(project.id, 'discussion-a');

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
  });
});
