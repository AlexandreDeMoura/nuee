import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FrozenContextItem } from '@nuee/shared-types';
import { DatabaseProvider } from '../database/database.provider';
import type {
  PersistedDiscussionMessage,
  VersionedPersistedDiscussion,
} from '../discussions/discussion.types';
import { SqliteDiscussionRepository } from '../discussions/sqlite-discussion.repository';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { KnowledgeExtractionService } from './knowledge-extraction.service';
import { SqliteKnowledgeExtractionRepository } from './sqlite-knowledge-extraction.repository';

describe('KnowledgeExtractionService source snapshots', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let discussions: SqliteDiscussionRepository;
  let extractions: SqliteKnowledgeExtractionRepository;
  let service: KnowledgeExtractionService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-30T12:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    discussions = new SqliteDiscussionRepository(databaseProvider);
    extractions = new SqliteKnowledgeExtractionRepository(databaseProvider);
    service = new KnowledgeExtractionService(
      projects,
      discussions,
      extractions,
    );
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createProject(title: string) {
    return projects.create({
      title,
      description: `Frozen description for ${title}.`,
    });
  }

  function createDiscussion(
    projectId: string,
    id: string,
    {
      title = 'Source discussion',
      completeFirstTurn = true,
      extraContextItems = [],
      startedAt = '2026-07-30T09:00:00.000Z',
    }: {
      title?: string | null;
      completeFirstTurn?: boolean;
      extraContextItems?: FrozenContextItem[];
      startedAt?: string;
    } = {},
  ) {
    const contextItems: FrozenContextItem[] = [
      {
        id: `context-${id}-project`,
        source_kind: 'project_description',
        source_id: projectId,
        source_title: 'Project description',
        frozen_content: projects.get(projectId).description,
        created_at: startedAt,
        display_order: 0,
      },
      ...extraContextItems,
    ];
    const record: VersionedPersistedDiscussion = {
      id,
      project_id: projectId,
      title,
      frozen_context: {
        version: 1,
        items: contextItems,
      },
      created_at: startedAt,
      updated_at: startedAt,
      last_activity_at: startedAt,
      deleted_at: null,
      context_version: 1,
      expected_context_item_count: contextItems.length,
      creation_idempotency_key: `create-${id}`,
      creation_request_fingerprint: 'a'.repeat(64),
    };
    const firstUser: PersistedDiscussionMessage = {
      id: `message-${id}-user-1`,
      discussion_id: id,
      role: 'user',
      content: `First question in ${id}`,
      created_at: startedAt,
      status: 'pending',
      request_id: `request-${id}-1`,
    };

    discussions.createWithFirstMessage(record, firstUser);
    const firstAssistant: PersistedDiscussionMessage = {
      id: `message-${id}-assistant-1`,
      discussion_id: id,
      role: 'assistant',
      content: `First answer in ${id}`,
      created_at: thisTimestampAfter(startedAt, 1),
      status: 'completed',
      request_id: null,
    };

    if (completeFirstTurn) {
      discussions.completeMessageGeneration(
        projectId,
        id,
        firstUser.id,
        firstAssistant,
        firstAssistant.created_at,
      );
    }

    return {
      record,
      contextItems,
      firstUser,
      firstAssistant,
    };
  }

  function appendCompletedTurn(
    projectId: string,
    discussionId: string,
    turn: number,
    startedAt: string,
  ) {
    const user: PersistedDiscussionMessage = {
      id: `message-${discussionId}-user-${turn}`,
      discussion_id: discussionId,
      role: 'user',
      content: `Question ${turn} in ${discussionId}`,
      created_at: startedAt,
      status: 'pending',
      request_id: `request-${discussionId}-${turn}`,
    };
    const assistant: PersistedDiscussionMessage = {
      id: `message-${discussionId}-assistant-${turn}`,
      discussion_id: discussionId,
      role: 'assistant',
      content: `Answer ${turn} in ${discussionId}`,
      created_at: thisTimestampAfter(startedAt, 1),
      status: 'completed',
      request_id: null,
    };

    discussions.appendMessage(projectId, user, user.created_at);
    discussions.completeMessageGeneration(
      projectId,
      discussionId,
      user.id,
      assistant,
      assistant.created_at,
    );
    return { user, assistant };
  }

  function appendPendingTurn(
    projectId: string,
    discussionId: string,
    turn: number,
    startedAt: string,
  ) {
    const user: PersistedDiscussionMessage = {
      id: `message-${discussionId}-user-${turn}`,
      discussion_id: discussionId,
      role: 'user',
      content: `Pending question ${turn}`,
      created_at: startedAt,
      status: 'pending',
      request_id: `request-${discussionId}-${turn}`,
    };

    discussions.appendMessage(projectId, user, user.created_at);
    return user;
  }

  function thisTimestampAfter(timestamp: string, milliseconds: number) {
    return new Date(Date.parse(timestamp) + milliseconds).toISOString();
  }

  function createSnapshot(
    projectId: string,
    discussionId: string,
    {
      idempotencyKey,
      messageSelection,
      contextItemIds = [],
    }: {
      idempotencyKey: string;
      messageSelection:
        | { kind: 'selected'; message_ids: string[] }
        | { kind: 'whole_discussion' };
      contextItemIds?: string[];
    },
  ) {
    return service.createSourceSnapshot(projectId, discussionId, {
      idempotency_key: idempotencyKey,
      message_selection: messageSelection,
      frozen_context_item_ids: contextItemIds,
    });
  }

  it('persists single and mixed non-consecutive messages in discussion chronology', () => {
    const project = createProject('Chronology');
    const source = createDiscussion(project.id, 'discussion-source', {
      extraContextItems: [
        {
          id: 'context-source-bubble',
          source_kind: 'bubble',
          source_id: 'bubble-source',
          source_title: 'Frozen constraint',
          frozen_content: 'The frozen constraint remains authoritative.',
          created_at: '2026-07-30T09:00:00.000Z',
          display_order: 1,
        },
      ],
    });
    appendCompletedTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T09:01:00.000Z',
    );
    const third = appendCompletedTurn(
      project.id,
      source.record.id,
      3,
      '2026-07-30T09:02:00.000Z',
    );

    const single = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-single',
      messageSelection: {
        kind: 'selected',
        message_ids: [source.firstAssistant.id],
      },
    });
    const mixed = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-mixed',
      messageSelection: {
        kind: 'selected',
        message_ids: [
          third.assistant.id,
          source.firstAssistant.id,
          source.firstUser.id,
        ],
      },
      contextItemIds: ['context-source-bubble'],
    });

    expect(single.source_snapshot.messages).toEqual([
      expect.objectContaining({
        source_id: source.firstAssistant.id,
        role: 'assistant',
        discussion_order: 0,
      }),
    ]);
    expect(
      mixed.source_snapshot.messages.map(
        ({ source_id, role, discussion_order }) => ({
          source_id,
          role,
          discussion_order,
        }),
      ),
    ).toEqual([
      {
        source_id: source.firstUser.id,
        role: 'user',
        discussion_order: 0,
      },
      {
        source_id: source.firstAssistant.id,
        role: 'assistant',
        discussion_order: 1,
      },
      {
        source_id: third.assistant.id,
        role: 'assistant',
        discussion_order: 2,
      },
    ]);
    expect(mixed.source_snapshot.frozen_context_items).toEqual([
      expect.objectContaining({
        source_id: 'context-source-bubble',
        context_source_kind: 'bubble',
        content: 'The frozen constraint remains authoritative.',
        display_order: 1,
      }),
    ]);
  });

  it('resolves whole discussion at submission and never changes the stored snapshot', () => {
    const project = createProject('Whole discussion');
    const source = createDiscussion(project.id, 'discussion-whole');
    const second = appendCompletedTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T09:01:00.000Z',
    );
    const beforeDiscussion = discussions.findByProjectAndId(
      project.id,
      source.record.id,
    );
    const beforeMessages = discussions.findAllMessages(
      project.id,
      source.record.id,
    );
    const firstAttempt = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-whole-first',
      messageSelection: { kind: 'whole_discussion' },
    });

    expect(
      discussions.findByProjectAndId(project.id, source.record.id),
    ).toEqual(beforeDiscussion);
    expect(discussions.findAllMessages(project.id, source.record.id)).toEqual(
      beforeMessages,
    );

    const third = appendCompletedTurn(
      project.id,
      source.record.id,
      3,
      '2026-07-30T09:02:00.000Z',
    );
    const reloadedFirst = extractions.findByProjectDiscussionAndId(
      project.id,
      source.record.id,
      firstAttempt.id,
    );
    const secondAttempt = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-whole-second',
      messageSelection: { kind: 'whole_discussion' },
    });

    expect(
      reloadedFirst?.source_snapshot.messages.map(({ source_id }) => source_id),
    ).toEqual([
      source.firstUser.id,
      source.firstAssistant.id,
      second.user.id,
      second.assistant.id,
    ]);
    expect(
      secondAttempt.source_snapshot.messages.map(({ source_id }) => source_id),
    ).toEqual([
      source.firstUser.id,
      source.firstAssistant.id,
      second.user.id,
      second.assistant.id,
      third.user.id,
      third.assistant.id,
    ]);
  });

  it('reads frozen context rows without dereferencing changed live sources', () => {
    const project = createProject('Frozen source');
    const source = createDiscussion(project.id, 'discussion-frozen');

    projects.updateDescription(project.id, {
      description: 'The live project description changed later.',
    });
    const attempt = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-frozen-context',
      messageSelection: { kind: 'selected', message_ids: [] },
      contextItemIds: [source.contextItems[0].id],
    });

    expect(attempt.source_snapshot.messages).toEqual([]);
    expect(attempt.source_snapshot.frozen_context_items).toEqual([
      expect.objectContaining({
        source_id: source.contextItems[0].id,
        context_source_kind: 'project_description',
        content: `Frozen description for ${project.title}.`,
      }),
    ]);
    expect(projects.get(project.id).description).toBe(
      'The live project description changed later.',
    );
  });

  it('returns every missing, inaccessible, cross-discussion, and cross-project identifier without writing', () => {
    const project = createProject('Owner');
    const otherProject = createProject('Other owner');
    const source = createDiscussion(project.id, 'discussion-source');
    const sameProjectOtherDiscussion = createDiscussion(
      project.id,
      'discussion-neighbor',
      { startedAt: '2026-07-30T10:00:00.000Z' },
    );
    const crossProjectDiscussion = createDiscussion(
      otherProject.id,
      'discussion-private',
      { startedAt: '2026-07-30T11:00:00.000Z' },
    );
    const pending = appendPendingTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T09:01:00.000Z',
    );

    expect(() =>
      createSnapshot(project.id, source.record.id, {
        idempotencyKey: 'extract-invalid-sources',
        messageSelection: {
          kind: 'selected',
          message_ids: [
            'message-missing',
            sameProjectOtherDiscussion.firstAssistant.id,
            crossProjectDiscussion.firstAssistant.id,
            pending.id,
          ],
        },
        contextItemIds: [
          'context-missing',
          sameProjectOtherDiscussion.contextItems[0].id,
          crossProjectDiscussion.contextItems[0].id,
        ],
      }),
    ).toThrow(UnprocessableEntityException);

    try {
      createSnapshot(project.id, source.record.id, {
        idempotencyKey: 'extract-invalid-sources-again',
        messageSelection: {
          kind: 'selected',
          message_ids: [
            'message-missing',
            sameProjectOtherDiscussion.firstAssistant.id,
            crossProjectDiscussion.firstAssistant.id,
            pending.id,
          ],
        },
        contextItemIds: [
          'context-missing',
          sameProjectOtherDiscussion.contextItems[0].id,
          crossProjectDiscussion.contextItems[0].id,
        ],
      });
    } catch (error) {
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_INVALID',
        message:
          'One or more selected extraction sources are unavailable. Review or remove the affected selections.',
        source_errors: [
          {
            source_kind: 'message',
            source_id: 'message-missing',
            reason: 'missing',
          },
          {
            source_kind: 'message',
            source_id: sameProjectOtherDiscussion.firstAssistant.id,
            reason: 'cross_discussion',
          },
          {
            source_kind: 'message',
            source_id: crossProjectDiscussion.firstAssistant.id,
            reason: 'cross_project',
          },
          {
            source_kind: 'message',
            source_id: pending.id,
            reason: 'inaccessible',
          },
          {
            source_kind: 'frozen_context',
            source_id: 'context-missing',
            reason: 'missing',
          },
          {
            source_kind: 'frozen_context',
            source_id: sameProjectOtherDiscussion.contextItems[0].id,
            reason: 'cross_discussion',
          },
          {
            source_kind: 'frozen_context',
            source_id: crossProjectDiscussion.contextItems[0].id,
            reason: 'cross_project',
          },
        ],
      });
    }

    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM knowledge_extraction_attempts')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('whole-discussion selection excludes pending and failed turns', () => {
    const project = createProject('Eligibility');
    const source = createDiscussion(project.id, 'discussion-eligibility');
    const pending = appendPendingTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T09:01:00.000Z',
    );

    const whilePending = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-with-pending',
      messageSelection: { kind: 'whole_discussion' },
    });
    discussions.updateMessageStatus(
      project.id,
      source.record.id,
      pending.id,
      'failed',
      '2026-07-30T09:01:01.000Z',
    );
    const afterFailure = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-after-failure',
      messageSelection: { kind: 'whole_discussion' },
    });

    expect(
      whilePending.source_snapshot.messages.map(({ source_id }) => source_id),
    ).toEqual([source.firstUser.id, source.firstAssistant.id]);
    expect(
      afterFailure.source_snapshot.messages.map(({ source_id }) => source_id),
    ).toEqual([source.firstUser.id, source.firstAssistant.id]);
  });

  it.each([
    {
      name: 'unknown top-level field',
      input: {
        idempotency_key: 'extract-validation',
        message_selection: { kind: 'whole_discussion' },
        frozen_context_item_ids: [],
        copied_source_text: 'Never trust this.',
      },
      fieldErrors: { copied_source_text: 'Unknown field.' },
    },
    {
      name: 'unknown nested field',
      input: {
        idempotency_key: 'extract-validation',
        message_selection: {
          kind: 'whole_discussion',
          message_ids: ['not-allowed'],
        },
        frozen_context_item_ids: [],
      },
      fieldErrors: { 'message_selection.message_ids': 'Unknown field.' },
    },
    {
      name: 'duplicate identifiers',
      input: {
        idempotency_key: 'extract-validation',
        message_selection: {
          kind: 'selected',
          message_ids: ['message-a', ' message-a '],
        },
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        'message_selection.message_ids':
          'Source identifiers must not contain duplicates.',
      },
    },
    {
      name: 'empty source selection',
      input: {
        idempotency_key: 'extract-validation',
        message_selection: {
          kind: 'selected',
          message_ids: [],
        },
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        message_selection:
          'Select at least one completed message or frozen context item.',
      },
    },
    {
      name: 'selection over the limit',
      input: {
        idempotency_key: 'extract-validation',
        message_selection: {
          kind: 'selected',
          message_ids: Array.from(
            { length: 101 },
            (_, index) => `message-${index}`,
          ),
        },
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        'message_selection.message_ids': 'Select no more than 100 sources.',
      },
    },
  ])(
    'rejects $name before resolving or persisting',
    ({ input, fieldErrors }) => {
      const project = createProject('Validation');
      const source = createDiscussion(project.id, 'discussion-validation');

      expect.assertions(3);

      try {
        service.createSourceSnapshot(project.id, source.record.id, input);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'KNOWLEDGE_EXTRACTION_VALIDATION_FAILED',
          message: 'Knowledge extraction input is invalid.',
          field_errors: fieldErrors,
        });
      }

      expect(
        databaseProvider.connection
          .prepare(
            'SELECT COUNT(*) AS count FROM knowledge_extraction_attempts',
          )
          .get(),
      ).toEqual({ count: 0 });
    },
  );

  it('rejects a whole discussion with no completed source', () => {
    const project = createProject('No eligible source');
    const source = createDiscussion(project.id, 'discussion-pending-only', {
      completeFirstTurn: false,
    });

    expect(() =>
      createSnapshot(project.id, source.record.id, {
        idempotencyKey: 'extract-empty-whole',
        messageSelection: { kind: 'whole_discussion' },
      }),
    ).toThrow(BadRequestException);
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM knowledge_extraction_attempts')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('translates snapshot persistence failures without exposing storage details', () => {
    const project = createProject('Persistence failure');
    const source = createDiscussion(project.id, 'discussion-persistence');
    jest.spyOn(extractions, 'create').mockImplementationOnce(() => {
      throw new Error('SQLITE_CONSTRAINT: internal detail');
    });

    expect(() =>
      createSnapshot(project.id, source.record.id, {
        idempotencyKey: 'extract-persistence-failure',
        messageSelection: {
          kind: 'selected',
          message_ids: [source.firstAssistant.id],
        },
      }),
    ).toThrow(ServiceUnavailableException);
  });
});
