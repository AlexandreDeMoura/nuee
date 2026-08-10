import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FrozenContextItem } from '@nuee/shared-types';
import { FakeModelClient } from '../ai/fake-model.client';
import { ConservativeInputTokenEstimator } from '../ai/input-token-estimator';
import type {
  GenerateStructuredOutputInput,
  ModelClient,
} from '../ai/model-client';
import { ConfiguredModelInputBudget } from '../ai/model-input-budget';
import type {
  ModelInputBudget,
  ModelInputBudgetResult,
} from '../ai/model-input-budget';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
import type {
  PersistedDiscussionMessage,
  VersionedPersistedDiscussion,
} from '../discussions/discussion.types';
import { BubbleLinksService } from '../bubbles/bubble-links.service';
import { SqliteDiscussionRepository } from '../discussions/sqlite-discussion.repository';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from '../territories/sqlite-territory.repository';
import { TerritoriesService } from '../territories/territories.service';
import { KnowledgeExtractionResolutionService } from './knowledge-extraction-resolution.service';
import { KnowledgeExtractionService } from './knowledge-extraction.service';
import { SqliteKnowledgeExtractionRepository } from './sqlite-knowledge-extraction.repository';

describe('Knowledge extraction generation and resolution services', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let discussions: SqliteDiscussionRepository;
  let extractions: SqliteKnowledgeExtractionRepository;
  let bubbles: BubblesService;
  let bubbleLinks: BubbleLinksService;
  let transactions: DatabaseTransaction;
  let resolutions: KnowledgeExtractionResolutionService;
  let modelClient: ModelClient;
  let modelInputBudget: ModelInputBudget;
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
    const bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    transactions = new DatabaseTransaction(databaseProvider);
    bubbles = new BubblesService(
      projects,
      bubbleRepository,
      new TerritoriesService(
        projects,
        new SqliteTerritoryRepository(databaseProvider),
      ),
      transactions,
    );
    bubbleLinks = new BubbleLinksService(projects, bubbles, bubbleRepository);
    resolutions = new KnowledgeExtractionResolutionService(
      projects,
      extractions,
      bubbles,
      transactions,
    );
    modelClient = new FakeModelClient();
    modelInputBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: 128_000,
        reservedOutputTokens: 4_000,
        inputSafetyMarginTokens: 8_000,
      },
      new ConservativeInputTokenEstimator(),
    );
    service = new KnowledgeExtractionService(
      projects,
      discussions,
      extractions,
      modelClient,
      modelInputBudget,
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
      messageIds,
      contextItemIds = [],
      instructions,
      detailLevel = 'standard',
    }: {
      idempotencyKey: string;
      messageIds: string[];
      contextItemIds?: string[];
      instructions?: string;
      detailLevel?: 'tight' | 'standard' | 'detailed';
    },
  ) {
    return service.createSourceSnapshot(projectId, discussionId, {
      idempotency_key: idempotencyKey,
      message_ids: messageIds,
      frozen_context_item_ids: contextItemIds,
      instructions,
      detail_level: detailLevel,
    });
  }

  function useModel(
    generateStructuredOutput: ModelClient['generateStructuredOutput'],
  ) {
    modelClient = {
      generateAnswer: jest.fn(),
      generateTitle: jest.fn(),
      generateStructuredOutput,
    };
    service = new KnowledgeExtractionService(
      projects,
      discussions,
      extractions,
      modelClient,
      modelInputBudget,
    );
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
      messageIds: [source.firstAssistant.id],
    });
    const mixed = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'extract-mixed',
      messageIds: [
        third.assistant.id,
        source.firstAssistant.id,
        source.firstUser.id,
      ],
      contextItemIds: ['context-source-bubble'],
    });

    expect(single.source_snapshot.messages).toEqual([
      expect.objectContaining({
        source_id: source.firstAssistant.id,
        role: 'assistant',
        discussion_order: 0,
      }),
    ]);
    expect(single.source_snapshot.message_selection_kind).toBe('selected');
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

  it('snapshots exactly the explicit message identifiers submitted', () => {
    const project = createProject('Explicit sources');
    const source = createDiscussion(project.id, 'discussion-explicit');
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
      idempotencyKey: 'extract-explicit-first',
      messageIds: [
        source.firstUser.id,
        source.firstAssistant.id,
        second.user.id,
        second.assistant.id,
      ],
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
      idempotencyKey: 'extract-explicit-second',
      messageIds: [
        source.firstUser.id,
        source.firstAssistant.id,
        second.user.id,
        second.assistant.id,
        third.user.id,
        third.assistant.id,
      ],
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
      messageIds: [],
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
        messageIds: [
          'message-missing',
          sameProjectOtherDiscussion.firstAssistant.id,
          crossProjectDiscussion.firstAssistant.id,
          pending.id,
        ],
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
        messageIds: [
          'message-missing',
          sameProjectOtherDiscussion.firstAssistant.id,
          crossProjectDiscussion.firstAssistant.id,
          pending.id,
        ],
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

  it('does not expand explicit identifiers to pending or failed turns', () => {
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
      messageIds: [source.firstUser.id, source.firstAssistant.id],
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
      messageIds: [source.firstUser.id, source.firstAssistant.id],
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
        detail_level: 'standard',
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
        copied_source_text: 'Never trust this.',
      },
      fieldErrors: { copied_source_text: 'Unknown field.' },
    },
    {
      name: 'removed whole-discussion selection',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_selection: { kind: 'whole_discussion' },
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
      },
      fieldErrors: { message_selection: 'Unknown field.' },
    },
    {
      name: 'missing detail level',
      input: {
        idempotency_key: 'extract-validation',
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        detail_level: 'Detail level must be one of: tight, standard, detailed.',
      },
    },
    {
      name: 'unknown detail level',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'verbose',
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        detail_level: 'Detail level must be one of: tight, standard, detailed.',
      },
    },
    {
      name: 'non-string instructions',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
        instructions: ['Do not accept arrays.'],
      },
      fieldErrors: { instructions: 'Instructions must be a string.' },
    },
    {
      name: 'instructions over the limit',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_ids: ['message-valid-shape'],
        frozen_context_item_ids: [],
        instructions: 'x'.repeat(2_001),
      },
      fieldErrors: {
        instructions: 'Instructions must be 2000 characters or fewer.',
      },
    },
    {
      name: 'duplicate identifiers',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_ids: ['message-a', ' message-a '],
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        message_ids: 'Source identifiers must not contain duplicates.',
      },
    },
    {
      name: 'empty source selection',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_ids: [],
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        message_ids:
          'Select at least one completed message or frozen context item.',
      },
    },
    {
      name: 'selection over the limit',
      input: {
        idempotency_key: 'extract-validation',
        detail_level: 'standard',
        message_ids: Array.from(
          { length: 101 },
          (_, index) => `message-${index}`,
        ),
        frozen_context_item_ids: [],
      },
      fieldErrors: {
        message_ids: 'Select no more than 100 sources.',
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

  it('rejects an empty explicit source selection', () => {
    const project = createProject('No eligible source');
    const source = createDiscussion(project.id, 'discussion-pending-only', {
      completeFirstTurn: false,
    });

    expect(() =>
      createSnapshot(project.id, source.record.id, {
        idempotencyKey: 'extract-empty-explicit',
        messageIds: [],
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
        messageIds: [source.firstAssistant.id],
      }),
    ).toThrow(ServiceUnavailableException);
  });

  it('generates and durably replays one deterministic grounded proposal', async () => {
    const project = createProject('Proposal');
    const source = createDiscussion(project.id, 'discussion-proposal');
    const generate = jest.spyOn(modelClient, 'generateStructuredOutput');
    const input = {
      idempotency_key: 'extract-proposal',
      detail_level: 'standard',
      message_ids: [source.firstAssistant.id],
      frozen_context_item_ids: [source.contextItems[0].id],
    };

    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      input,
    );
    const replayed = await service.generateProposal(
      project.id,
      source.record.id,
      input,
    );
    const stored = extractions.findByProjectDiscussionAndId(
      project.id,
      source.record.id,
      generated.id,
    );

    expect(typeof generated.id).toBe('string');
    expect(generated).toEqual({
      id: generated.id,
      project_id: project.id,
      discussion_id: source.record.id,
      status: 'ready',
      proposal: {
        title: 'Deterministic knowledge proposal',
        summary: 'A grounded proposal synthesized from the selected sources.',
        content:
          'This deterministic proposal represents one reusable knowledge unit grounded in the selected discussion sources.',
      },
      source: {
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [source.contextItems[0].id],
      },
      created_at: '2026-07-30T12:00:00.000Z',
      expires_at: '2026-07-31T12:00:00.000Z',
    });
    expect(replayed).toEqual(generated);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({
      status: 'ready',
      proposal: generated.proposal,
      retry_count: 0,
    });
    expect(JSON.stringify(generated.proposal)).not.toContain(source.record.id);
    expect(JSON.stringify(generated.proposal)).not.toContain(
      source.firstAssistant.id,
    );
    expect(JSON.stringify(generated.proposal)).not.toContain(
      source.contextItems[0].id,
    );
  });

  it('normalizes and persists intent as part of the idempotent request', async () => {
    const project = createProject('Directed proposal');
    const source = createDiscussion(project.id, 'discussion-directed');
    const generate = jest.spyOn(modelClient, 'generateStructuredOutput');
    const input = {
      idempotency_key: 'extract-directed',
      detail_level: 'detailed',
      message_ids: [source.firstAssistant.id],
      frozen_context_item_ids: [],
      instructions: '  Emphasize\n delivery   risk.  ',
    };

    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      input,
    );
    const replayed = await service.generateProposal(
      project.id,
      source.record.id,
      {
        ...input,
        instructions: 'Emphasize delivery risk.',
      },
    );
    const stored = extractions.findByProjectDiscussionAndId(
      project.id,
      source.record.id,
      generated.id,
    );

    expect(replayed).toEqual(generated);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({
      instructions: 'Emphasize\n delivery   risk.',
      detail_level: 'detailed',
    });
    expect(generate.mock.calls[0][0].instructions).toContain(
      'target two or three concise paragraphs',
    );
    expect(generate.mock.calls[0][0].messages[0].content).toContain(
      JSON.stringify({ instructions: 'Emphasize\n delivery   risk.' }),
    );

    await expect(
      service.generateProposal(project.id, source.record.id, {
        ...input,
        instructions: 'Emphasize logistics.',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT' },
    });
    await expect(
      service.generateProposal(project.id, source.record.id, {
        ...input,
        detail_level: 'tight',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT' },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: 'a non-object',
      idempotencySuffix: 'non-object',
      output: 'not a proposal',
    },
    {
      name: 'an empty field',
      idempotencySuffix: 'empty-field',
      output: { title: 'Title', summary: ' ', content: 'Content' },
    },
    {
      name: 'an extra metadata field',
      idempotencySuffix: 'metadata-field',
      output: {
        title: 'Title',
        summary: 'Summary.',
        content: 'Content',
        message_id: 'internal',
      },
    },
  ])(
    'fails generation when the model returns $name',
    async ({ output, idempotencySuffix }) => {
      const project = createProject('Malformed');
      const source = createDiscussion(project.id, 'discussion-malformed');
      const idempotencyKey = `extract-malformed-${idempotencySuffix}`;
      useModel(
        jest.fn().mockResolvedValue({
          output,
          model: 'malformed-test-model',
        }),
      );

      await expect(
        service.generateProposal(project.id, source.record.id, {
          idempotency_key: idempotencyKey,
          detail_level: 'standard',
          message_ids: [source.firstAssistant.id],
          frozen_context_item_ids: [],
        }),
      ).rejects.toMatchObject({
        constructor: ServiceUnavailableException,
        response: {
          code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
          message:
            'The knowledge proposal could not be generated. Retry with the same idempotency key.',
        },
      });

      expect(
        extractions.findByProjectDiscussionAndIdempotencyKey(
          project.id,
          source.record.id,
          idempotencyKey,
        ),
      ).toMatchObject({
        status: 'failed',
        proposal: null,
      });
    },
  );

  it('retries provider failure against the original stored snapshot', async () => {
    const project = createProject('Retry');
    const source = createDiscussion(project.id, 'discussion-retry');
    const modelInputs: unknown[] = [];
    const generate = jest
      .fn<ModelClient['generateStructuredOutput']>()
      .mockImplementation((input) => {
        modelInputs.push(input);

        if (modelInputs.length === 1) {
          return Promise.reject(new Error('Provider unavailable'));
        }

        return Promise.resolve({
          output: {
            title: 'Recovered proposal',
            summary: 'The original source snapshot was reused.',
            content: 'The retry did not include messages added later.',
          },
          model: 'retry-test-model',
        });
      });
    useModel(generate);
    const input = {
      idempotency_key: 'extract-provider-retry',
      detail_level: 'detailed',
      message_ids: [source.firstUser.id, source.firstAssistant.id],
      frozen_context_item_ids: [],
      instructions: 'Preserve the original framing.',
    };

    await expect(
      service.generateProposal(project.id, source.record.id, input),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: { code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED' },
    });
    appendCompletedTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T12:01:00.000Z',
    );

    const recovered = await service.generateProposal(
      project.id,
      source.record.id,
      input,
    );
    const stored = extractions.findByProjectDiscussionAndId(
      project.id,
      source.record.id,
      recovered.id,
    );

    expect(recovered.proposal.title).toBe('Recovered proposal');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(modelInputs[1]).toEqual(modelInputs[0]);
    expect(stored).toMatchObject({
      status: 'ready',
      retry_count: 1,
      instructions: 'Preserve the original framing.',
      detail_level: 'detailed',
    });
    expect(stored?.source_snapshot.messages).toHaveLength(2);
  });

  it('shares one in-flight generation and replays the completed proposal', async () => {
    const project = createProject('Concurrent');
    const source = createDiscussion(project.id, 'discussion-concurrent');
    let resolveGeneration:
      | ((
          value: Awaited<ReturnType<ModelClient['generateStructuredOutput']>>,
        ) => void)
      | undefined;
    const pendingGeneration = new Promise<
      Awaited<ReturnType<ModelClient['generateStructuredOutput']>>
    >((resolve) => {
      resolveGeneration = resolve;
    });
    const generate = jest.fn(() => pendingGeneration);
    useModel(generate);
    const input = {
      idempotency_key: 'extract-concurrent',
      detail_level: 'standard',
      message_ids: [source.firstAssistant.id],
      frozen_context_item_ids: [],
    };

    const first = service.generateProposal(project.id, source.record.id, input);
    const second = service.generateProposal(
      project.id,
      source.record.id,
      input,
    );

    expect(generate).toHaveBeenCalledTimes(1);
    resolveGeneration?.({
      output: {
        title: 'One proposal',
        summary: 'Concurrent requests shared one generation.',
        content: 'Exactly one proposal was generated and persisted.',
      },
      model: 'concurrency-test-model',
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const repeated = await service.generateProposal(
      project.id,
      source.record.id,
      input,
    );

    expect(secondResult).toEqual(firstResult);
    expect(repeated).toEqual(firstResult);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects idempotency-key reuse with a different selection', async () => {
    const project = createProject('Conflict');
    const source = createDiscussion(project.id, 'discussion-conflict');
    const second = appendCompletedTurn(
      project.id,
      source.record.id,
      2,
      '2026-07-30T09:01:00.000Z',
    );
    const generate = jest.spyOn(modelClient, 'generateStructuredOutput');

    await service.generateProposal(project.id, source.record.id, {
      idempotency_key: 'extract-conflict',
      detail_level: 'standard',
      message_ids: [source.firstAssistant.id],
      frozen_context_item_ids: [],
    });

    await expect(
      service.generateProposal(project.id, source.record.id, {
        idempotency_key: 'extract-conflict',
        detail_level: 'standard',
        message_ids: [second.assistant.id],
        frozen_context_item_ids: [],
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: {
        code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
        message:
          'The idempotency key has already been used with a different extraction request.',
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized source input before persisting or calling the model', async () => {
    const project = createProject('Oversized');
    const source = createDiscussion(project.id, 'discussion-oversized');
    const budgetResult: ModelInputBudgetResult = {
      fits: false,
      estimatedInputTokens: 1_001,
      inputTokenLimit: 1_100,
      availableInputTokens: 1_000,
      reservedOutputTokens: 50,
      safetyMarginTokens: 50,
    };
    let evaluatedInput: GenerateStructuredOutputInput | undefined;
    const evaluateStructuredOutput = jest.fn(
      (input: GenerateStructuredOutputInput): ModelInputBudgetResult => {
        evaluatedInput = input;
        return budgetResult;
      },
    );
    modelInputBudget = {
      evaluateAnswer: jest.fn(),
      evaluateStructuredOutput,
    };
    const generate = jest.spyOn(modelClient, 'generateStructuredOutput');
    service = new KnowledgeExtractionService(
      projects,
      discussions,
      extractions,
      modelClient,
      modelInputBudget,
    );

    await expect(
      service.generateProposal(project.id, source.record.id, {
        idempotency_key: 'extract-oversized',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
        instructions: 'Prioritize launch risk.',
      }),
    ).rejects.toMatchObject({
      constructor: PayloadTooLargeException,
      response: {
        code: 'KNOWLEDGE_EXTRACTION_SOURCE_TOO_LARGE',
        message:
          'The selected extraction sources and instructions exceed the supported model input budget. Shorten the instructions or select fewer sources and try again.',
        estimated_input_tokens: 1_001,
        available_input_tokens: 1_000,
      },
    });
    expect(evaluateStructuredOutput).toHaveBeenCalledTimes(1);
    expect(evaluatedInput?.messages[0].content).toContain(
      JSON.stringify({ instructions: 'Prioritize launch risk.' }),
    );
    expect(generate).not.toHaveBeenCalled();
    expect(
      databaseProvider.connection
        .prepare('SELECT COUNT(*) AS count FROM knowledge_extraction_attempts')
        .get(),
    ).toEqual({ count: 0 });
  });

  it('atomically resolves a reviewed proposal into the ungrouped territory and replays it', async () => {
    const project = createProject('Resolved knowledge');
    const source = createDiscussion(project.id, 'discussion-resolution');
    bubbles.create(project.id, {
      title: 'Existing cluster',
      content: 'Anchor the standard cluster placement.',
    });
    const discussionBefore = discussions.findByProjectAndId(
      project.id,
      source.record.id,
    );
    const messagesBefore = discussions.findAllMessages(
      project.id,
      source.record.id,
    );
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'resolve-as-new-bubble',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [source.contextItems[0].id],
      },
    );
    const resolutionInput = {
      kind: 'new_bubble',
      proposal: {
        title: '  Reviewed decision  ',
        summary: '   ',
        content: '  Keep this final reviewed knowledge.  ',
      },
    };
    const resolved = resolutions.resolveProposal(
      project.id,
      source.record.id,
      generated.id,
      resolutionInput,
    );

    expect(resolved).toMatchObject({
      id: generated.id,
      project_id: project.id,
      discussion_id: source.record.id,
      status: 'resolved',
      resolution: {
        kind: 'new_bubble',
        bubble: {
          project_id: project.id,
          title: 'Reviewed decision',
          summary: null,
          content: 'Keep this final reviewed knowledge.',
          source_kind: 'discussion',
          source_discussion_id: source.record.id,
          source_discussion_title: source.record.title,
          source_discussion_deleted_at: null,
          source_message_ids: [source.firstAssistant.id],
          source_context_item_ids: [source.contextItems[0].id],
        },
      },
    });
    expect(resolved.resolution).toHaveProperty(
      'bubble.territory_id',
      expect.any(String),
    );
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'resolved',
      resolution_kind: 'new_bubble',
      resulting_bubble_id:
        resolved.resolution.kind === 'new_bubble'
          ? resolved.resolution.bubble.id
          : undefined,
    });
    expect(
      resolutions.resolveProposal(
        project.id,
        source.record.id,
        generated.id,
        resolutionInput,
      ),
    ).toEqual(resolved);
    expect(() =>
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'new_bubble',
        proposal: {
          ...resolutionInput.proposal,
          content: 'A conflicting second resolution.',
        },
      }),
    ).toThrow(ConflictException);
    expect(bubbles.list(project.id)).toHaveLength(2);
    expect(
      discussions.findByProjectAndId(project.id, source.record.id),
    ).toEqual(discussionBefore);
    expect(discussions.findAllMessages(project.id, source.record.id)).toEqual(
      messagesBefore,
    );
  });

  it('rolls back the bubble when final resolution persistence fails', async () => {
    const project = createProject('Atomic rollback');
    const source = createDiscussion(project.id, 'discussion-rollback');
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'resolve-with-failed-persistence',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );
    jest.spyOn(extractions, 'markResolved').mockImplementationOnce(() => {
      throw new Error('Simulated attempt persistence failure.');
    });

    expect(() =>
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'new_bubble',
        proposal: generated.proposal,
      }),
    ).toThrow(ServiceUnavailableException);
    expect(bubbles.list(project.id)).toEqual([]);
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'ready',
      proposal: generated.proposal,
      resolution_kind: null,
      resulting_bubble_id: null,
    });
  });

  it('atomically updates one target while preserving territory, links, creation time, and frozen context', async () => {
    const project = createProject('Updated knowledge');
    const target = bubbles.create(project.id, {
      title: 'Original target',
      summary: 'Original summary.',
      content: 'Original target content.',
    });
    const linkedBubble = bubbles.create(project.id, {
      title: 'Linked neighbor',
      content: 'Keep this manual relationship.',
    });
    const link = bubbleLinks.create(project.id, {
      bubble_a_id: target.id,
      bubble_b_id: linkedBubble.id,
    });
    const source = createDiscussion(project.id, 'discussion-update', {
      extraContextItems: [
        {
          id: 'context-update-target',
          source_kind: 'bubble',
          source_id: target.id,
          source_title: target.title,
          frozen_content: target.content,
          created_at: '2026-07-30T09:00:00.000Z',
          display_order: 1,
        },
      ],
    });
    const frozenDiscussionBefore = discussions.findByProjectAndId(
      project.id,
      source.record.id,
    );
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'resolve-as-bubble-update',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: ['context-update-target'],
      },
    );
    const resolutionInput = {
      kind: 'update_bubble',
      proposal: {
        title: '  Reviewed replacement  ',
        summary: '   ',
        content: '  Replace only the editable knowledge fields.  ',
      },
      target_bubble_id: target.id,
      expected_updated_at: target.updated_at,
    };

    const resolved = resolutions.resolveProposal(
      project.id,
      source.record.id,
      generated.id,
      resolutionInput,
    );

    expect(resolved).toMatchObject({
      id: generated.id,
      project_id: project.id,
      discussion_id: source.record.id,
      status: 'resolved',
      resolution: {
        kind: 'update_bubble',
        bubble: {
          id: target.id,
          project_id: project.id,
          title: 'Reviewed replacement',
          summary: null,
          content: 'Replace only the editable knowledge fields.',
          territory_id: target.territory_id,
          created_at: target.created_at,
          source_kind: 'discussion',
          source_discussion_id: source.record.id,
          source_discussion_title: source.record.title,
          source_discussion_deleted_at: null,
          source_message_ids: [source.firstAssistant.id],
          source_context_item_ids: ['context-update-target'],
        },
      },
    });

    if (resolved.resolution.kind !== 'update_bubble') {
      throw new Error('Expected a bubble-update resolution.');
    }

    expect(Date.parse(resolved.resolution.bubble.updated_at)).toBeGreaterThan(
      Date.parse(target.updated_at),
    );
    expect(bubbleLinks.list(project.id)).toEqual([link]);
    expect(
      discussions.findByProjectAndId(project.id, source.record.id),
    ).toEqual(frozenDiscussionBefore);
    expect(
      (
        discussions.findByProjectAndId(project.id, source.record.id)
          ?.frozen_context as { items: FrozenContextItem[] }
      ).items[1],
    ).toMatchObject({
      source_id: target.id,
      source_title: target.title,
      frozen_content: target.content,
    });
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'resolved',
      resolution_kind: 'update_bubble',
      resulting_bubble_id: target.id,
    });

    jest.setSystemTime(new Date('2026-07-30T13:00:00.000Z'));
    expect(
      resolutions.resolveProposal(
        project.id,
        source.record.id,
        generated.id,
        resolutionInput,
      ),
    ).toEqual(resolved);
    expect(bubbles.get(project.id, target.id)).toEqual(
      resolved.resolution.bubble,
    );
  });

  it('returns a safe current-target preview after a concurrent edit and accepts a newly confirmed version', async () => {
    const project = createProject('Concurrent target');
    const target = bubbles.create(project.id, {
      title: 'Selected target',
      summary: 'Selected summary.',
      content: 'Selected target content.',
    });
    const source = createDiscussion(project.id, 'discussion-target-conflict');
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'resolve-after-target-conflict',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );
    const concurrentTarget = bubbles.update(project.id, target.id, {
      title: 'Concurrent edit',
      summary: 'Review this current value.',
      content: 'Another client changed this knowledge.',
    });
    const reviewedProposal = {
      title: 'Confirmed extraction update',
      summary: 'Apply only after reviewing the conflict.',
      content: 'This proposal is explicitly confirmed against the new version.',
    };

    expect.assertions(7);

    try {
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'update_bubble',
        proposal: reviewedProposal,
        target_bubble_id: target.id,
        expected_updated_at: target.updated_at,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toEqual({
        code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED',
        message:
          'The target bubble changed after it was selected. Review the current target before confirming again.',
        current_target: {
          id: concurrentTarget.id,
          title: concurrentTarget.title,
          summary: concurrentTarget.summary,
          content: concurrentTarget.content,
          updated_at: concurrentTarget.updated_at,
        },
      });
    }

    expect(bubbles.get(project.id, target.id)).toEqual(concurrentTarget);
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'ready',
      resolution_kind: null,
      resulting_bubble_id: null,
    });

    const resolved = resolutions.resolveProposal(
      project.id,
      source.record.id,
      generated.id,
      {
        kind: 'update_bubble',
        proposal: reviewedProposal,
        target_bubble_id: target.id,
        expected_updated_at: concurrentTarget.updated_at,
      },
    );

    expect(resolved).toMatchObject({
      resolution: {
        kind: 'update_bubble',
        bubble: {
          id: target.id,
          title: reviewedProposal.title,
          summary: reviewedProposal.summary,
          content: reviewedProposal.content,
        },
      },
    });
    expect(resolved.resolution).toHaveProperty(
      'bubble.updated_at',
      '2026-07-30T12:00:00.002Z',
    );
    expect(resolved.resolution).toHaveProperty(
      'bubble.territory_id',
      target.territory_id,
    );
  });

  it('rejects missing, deleted, and cross-project update targets without resolving the proposal', async () => {
    const project = createProject('Target owner');
    const otherProject = createProject('Other target owner');
    const source = createDiscussion(project.id, 'discussion-target-scope');
    const crossProjectTarget = bubbles.create(otherProject.id, {
      title: 'Private target',
      content: 'This target belongs to another project.',
    });
    const deletedTarget = bubbles.create(project.id, {
      title: 'Deleted target',
      content: 'This target will become unavailable.',
    });
    bubbles.delete(project.id, deletedTarget.id);

    for (const [suffix, targetBubbleId, expectedUpdatedAt] of [
      ['missing', 'missing-target', '2026-07-30T12:00:00.000Z'],
      ['deleted', deletedTarget.id, deletedTarget.updated_at],
      ['cross-project', crossProjectTarget.id, crossProjectTarget.updated_at],
    ] as const) {
      const generated = await service.generateProposal(
        project.id,
        source.record.id,
        {
          idempotency_key: `resolve-${suffix}-target`,
          detail_level: 'standard',
          message_ids: [source.firstAssistant.id],
          frozen_context_item_ids: [],
        },
      );

      try {
        resolutions.resolveProposal(
          project.id,
          source.record.id,
          generated.id,
          {
            kind: 'update_bubble',
            proposal: generated.proposal,
            target_bubble_id: targetBubbleId,
            expected_updated_at: expectedUpdatedAt,
          },
        );
        throw new Error('Expected the unavailable target to be rejected.');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'KNOWLEDGE_EXTRACTION_TARGET_NOT_FOUND',
          message: `Target bubble "${targetBubbleId}" was not found in project "${project.id}".`,
        });
      }

      expect(
        extractions.findByProjectDiscussionAndId(
          project.id,
          source.record.id,
          generated.id,
        ),
      ).toMatchObject({
        status: 'ready',
        resolution_kind: null,
        resulting_bubble_id: null,
      });
    }

    expect(bubbles.get(otherProject.id, crossProjectTarget.id)).toEqual(
      crossProjectTarget,
    );
  });

  it('rolls back updated content and provenance when final resolution persistence fails', async () => {
    const project = createProject('Update rollback');
    const target = bubbles.create(project.id, {
      title: 'Stable target',
      summary: 'Stable summary.',
      content: 'Keep this content if the transaction fails.',
    });
    const source = createDiscussion(project.id, 'discussion-update-rollback');
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'resolve-update-with-failed-persistence',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );
    jest.spyOn(extractions, 'markResolved').mockImplementationOnce(() => {
      throw new Error('Simulated attempt persistence failure.');
    });

    expect(() =>
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'update_bubble',
        proposal: generated.proposal,
        target_bubble_id: target.id,
        expected_updated_at: target.updated_at,
      }),
    ).toThrow(ServiceUnavailableException);
    expect(bubbles.get(project.id, target.id)).toEqual(target);
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'ready',
      resolution_kind: null,
      resulting_bubble_id: null,
    });
  });

  it('rejects or discards without creating bubbles or changing discussion activity', async () => {
    const project = createProject('No bubble resolutions');
    const source = createDiscussion(project.id, 'discussion-no-bubble');
    const discussionBefore = discussions.findByProjectAndId(
      project.id,
      source.record.id,
    );
    const messagesBefore = discussions.findAllMessages(
      project.id,
      source.record.id,
    );
    const rejectedProposal = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'reject-proposal',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );
    const rejected = resolutions.resolveProposal(
      project.id,
      source.record.id,
      rejectedProposal.id,
      { kind: 'reject' },
    );

    expect(rejected).toEqual({
      id: rejectedProposal.id,
      project_id: project.id,
      discussion_id: source.record.id,
      status: 'resolved',
      resolution: { kind: 'reject' },
    });
    expect(
      resolutions.resolveProposal(
        project.id,
        source.record.id,
        rejectedProposal.id,
        { kind: 'reject' },
      ),
    ).toEqual(rejected);
    expect(() =>
      resolutions.resolveProposal(
        project.id,
        source.record.id,
        rejectedProposal.id,
        {
          kind: 'new_bubble',
          proposal: rejectedProposal.proposal,
        },
      ),
    ).toThrow(ConflictException);
    await expect(
      service.generateProposal(project.id, source.record.id, {
        idempotency_key: 'reject-proposal',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      }),
    ).resolves.toEqual(rejectedProposal);

    const discardedProposal = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'discard-proposal',
        detail_level: 'standard',
        message_ids: [source.firstUser.id],
        frozen_context_item_ids: [],
      },
    );

    resolutions.discardProposal(
      project.id,
      source.record.id,
      discardedProposal.id,
    );
    resolutions.discardProposal(
      project.id,
      source.record.id,
      discardedProposal.id,
    );
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        discardedProposal.id,
      ),
    ).toMatchObject({
      status: 'discarded',
      proposal: null,
      resolution_kind: null,
      resulting_bubble_id: null,
    });
    expect(() =>
      resolutions.resolveProposal(
        project.id,
        source.record.id,
        discardedProposal.id,
        { kind: 'reject' },
      ),
    ).toThrow(ConflictException);
    expect(bubbles.list(project.id)).toEqual([]);
    expect(
      discussions.findByProjectAndId(project.id, source.record.id),
    ).toEqual(discussionBefore);
    expect(discussions.findAllMessages(project.id, source.record.id)).toEqual(
      messagesBefore,
    );
  });

  it('keeps invalid reviewed proposals available for correction', async () => {
    const project = createProject('Reviewed validation');
    const source = createDiscussion(project.id, 'discussion-validation');
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'invalid-reviewed-proposal',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );

    expect(() =>
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'new_bubble',
        proposal: {
          title: ' ',
          summary: 'Still optional.',
          content: ' ',
        },
      }),
    ).toThrow(BadRequestException);
    expect(bubbles.list(project.id)).toEqual([]);
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'ready',
      proposal: generated.proposal,
    });
  });

  it('requires one target identifier and its observed update timestamp', async () => {
    const project = createProject('Update target validation');
    const source = createDiscussion(
      project.id,
      'discussion-update-target-validation',
    );
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'invalid-update-target',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );

    expect.assertions(4);

    try {
      resolutions.resolveProposal(project.id, source.record.id, generated.id, {
        kind: 'update_bubble',
        proposal: generated.proposal,
        target_bubble_id: ['bubble-one', 'bubble-two'],
        target_bubble_ids: ['bubble-one', 'bubble-two'],
        expected_updated_at: ' ',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_VALIDATION_FAILED',
        message: 'Knowledge extraction resolution is invalid.',
        field_errors: {
          target_bubble_ids: 'Unknown field.',
          target_bubble_id: 'Target bubble identifier is required.',
          expected_updated_at: 'Observed target update timestamp is required.',
        },
      });
    }

    expect(bubbles.list(project.id)).toEqual([]);
    expect(
      extractions.findByProjectDiscussionAndId(
        project.id,
        source.record.id,
        generated.id,
      ),
    ).toMatchObject({
      status: 'ready',
      resolution_kind: null,
    });
  });

  it('requires a ready attempt in the exact project and discussion scope', async () => {
    const project = createProject('Resolution scope');
    const source = createDiscussion(project.id, 'discussion-scope');
    const otherProject = createProject('Other resolution scope');
    const otherDiscussion = createDiscussion(
      otherProject.id,
      'discussion-other-scope',
    );
    const generated = await service.generateProposal(
      project.id,
      source.record.id,
      {
        idempotency_key: 'scoped-resolution',
        detail_level: 'standard',
        message_ids: [source.firstAssistant.id],
        frozen_context_item_ids: [],
      },
    );

    expect(() =>
      resolutions.resolveProposal(
        otherProject.id,
        source.record.id,
        generated.id,
        {
          kind: 'reject',
        },
      ),
    ).toThrow(NotFoundException);
    expect(() =>
      resolutions.resolveProposal(
        project.id,
        otherDiscussion.record.id,
        generated.id,
        { kind: 'reject' },
      ),
    ).toThrow(NotFoundException);

    const generating = createSnapshot(project.id, source.record.id, {
      idempotencyKey: 'not-ready-resolution',
      messageIds: [source.firstAssistant.id],
    });

    expect(() =>
      resolutions.resolveProposal(project.id, source.record.id, generating.id, {
        kind: 'reject',
      }),
    ).toThrow(ConflictException);
    expect(bubbles.list(project.id)).toEqual([]);
  });
});
