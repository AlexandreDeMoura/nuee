import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { FrozenContextV1 } from '@nuee/shared-types';
import { CanonicalFrozenContextFormatter } from '../ai/frozen-context.formatter';
import { ConservativeInputTokenEstimator } from '../ai/input-token-estimator';
import type {
  GenerateAnswerInput,
  GenerateTitleInput,
  ModelClient,
  ModelGeneration,
} from '../ai/model-client';
import { ModelGenerationError } from '../ai/model-client';
import { ConfiguredModelInputBudget } from '../ai/model-input-budget';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
import { DiscussionContextAssembler } from '../discussion-context/discussion-context.assembler';
import type {
  DocumentContextSourceReadResult,
  DocumentContextSourceReader,
} from '../discussion-context/discussion-context.types';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from '../territories/sqlite-territory.repository';
import { TerritoriesService } from '../territories/territories.service';
import { DiscussionsService } from './discussions.service';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

class FakeDocumentContextSourceReader implements DocumentContextSourceReader {
  readonly results = new Map<string, DocumentContextSourceReadResult>();

  readContextSource(
    _projectId: string,
    documentId: string,
  ): DocumentContextSourceReadResult {
    return (
      this.results.get(documentId) ?? {
        status: 'unavailable',
        reason: 'missing',
      }
    );
  }
}

class ControllableModelClient implements ModelClient {
  readonly answerInputs: GenerateAnswerInput[] = [];
  readonly titleInputs: GenerateTitleInput[] = [];
  answer = 'A focused answer.';
  title = 'Generated discussion title';
  answerFailure: Error | undefined;
  answerAttribution: Pick<ModelGeneration, 'webSearchUsed' | 'citations'> = {};
  titleFailure: Error | undefined;
  titleGeneration: Promise<ModelGeneration> | undefined;

  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration> {
    this.answerInputs.push(input);

    if (this.answerFailure) {
      return Promise.reject(this.answerFailure);
    }

    return Promise.resolve({
      content: this.answer,
      model: 'test-model',
      ...this.answerAttribution,
    });
  }

  generateTitle(input: GenerateTitleInput): Promise<ModelGeneration> {
    this.titleInputs.push(input);

    if (this.titleFailure) {
      return Promise.reject(this.titleFailure);
    }

    if (this.titleGeneration) {
      return this.titleGeneration;
    }

    return Promise.resolve({
      content: this.title,
      model: 'test-model',
    });
  }
}

describe('DiscussionsService', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let bubbleRepository: SqliteBubbleRepository;
  let bubbles: BubblesService;
  let repository: SqliteDiscussionRepository;
  let transactions: DatabaseTransaction;
  let modelClient: ControllableModelClient;
  let contextFormatter: CanonicalFrozenContextFormatter;
  let modelInputBudget: ConfiguredModelInputBudget;
  let documents: FakeDocumentContextSourceReader;
  let contextAssembler: DiscussionContextAssembler;
  let service: DiscussionsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-27T10:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    transactions = new DatabaseTransaction(databaseProvider);
    bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    bubbles = new BubblesService(
      projects,
      bubbleRepository,
      new TerritoriesService(
        projects,
        new SqliteTerritoryRepository(databaseProvider),
      ),
      transactions,
    );
    repository = new SqliteDiscussionRepository(databaseProvider);
    modelClient = new ControllableModelClient();
    contextFormatter = new CanonicalFrozenContextFormatter();
    modelInputBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: 128_000,
        reservedOutputTokens: 4_000,
        inputSafetyMarginTokens: 8_000,
      },
      new ConservativeInputTokenEstimator(),
    );
    documents = new FakeDocumentContextSourceReader();
    contextAssembler = new DiscussionContextAssembler(
      projects,
      bubbles,
      documents,
    );
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
      contextFormatter,
      modelInputBudget,
      contextAssembler,
      bubbleRepository,
      transactions,
      { web_search: false },
    );
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createProject(title = 'Research') {
    return projects.create({
      title,
      description: `Frozen description for ${title}.`,
    });
  }

  async function createDiscussion(
    projectId: string,
    prompt = 'First?',
    {
      bubbleIds = [],
      documentIds = [],
      idempotencyKey = `create:${prompt}`,
      webSearch = false,
    }: {
      bubbleIds?: string[];
      documentIds?: string[];
      idempotencyKey?: string;
      webSearch?: boolean;
    } = {},
  ) {
    return service.create(projectId, {
      project_id: projectId,
      first_prompt: prompt,
      idempotency_key: idempotencyKey,
      bubble_ids: bubbleIds,
      document_ids: documentIds,
      ...(webSearch ? { web_search: true } : {}),
    });
  }

  function enableWebSearch(): void {
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
      contextFormatter,
      modelInputBudget,
      contextAssembler,
      bubbleRepository,
      transactions,
      { web_search: true },
    );
  }

  it('atomically creates selected context and the first turn before forwarding the frozen package', async () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Decision constraints',
      content: 'The launch must remain reversible.',
    });
    const details = await createDiscussion(
      project.id,
      '  What should we decide first?  ',
      {
        bubbleIds: [bubble.id, bubble.id],
        idempotencyKey: 'create-first-decision',
      },
    );

    expect(details).toMatchObject({
      project_id: project.id,
      title: 'New discussion',
      frozen_context: {
        version: 1,
        items: [
          {
            source_kind: 'project_description',
            source_id: project.id,
            source_title: 'Project description',
            frozen_content: project.description,
            created_at: '2026-07-27T10:00:00.000Z',
            display_order: 0,
          },
          {
            source_kind: 'bubble',
            source_id: bubble.id,
            source_title: bubble.title,
            frozen_content: bubble.content,
            created_at: '2026-07-27T10:00:00.000Z',
            display_order: 1,
          },
        ],
      },
    });
    expect(details.messages[0].id).toEqual(expect.any(String));
    expect(details.messages[0].request_id).toEqual(expect.any(String));
    expect(details.messages[1].id).toEqual(expect.any(String));
    expect(details.messages).toEqual([
      {
        id: details.messages[0].id,
        discussion_id: details.id,
        role: 'user',
        content: 'What should we decide first?',
        created_at: '2026-07-27T10:00:00.000Z',
        status: 'completed',
        request_id: details.messages[0].request_id,
      },
      {
        id: details.messages[1].id,
        discussion_id: details.id,
        role: 'assistant',
        content: 'A focused answer.',
        created_at: '2026-07-27T10:00:00.001Z',
        status: 'completed',
        request_id: null,
      },
    ]);
    expect(modelClient.answerInputs).toEqual([
      {
        formattedContext: contextFormatter.format(details.frozen_context),
        messages: [
          {
            role: 'user',
            content: 'What should we decide first?',
          },
        ],
      },
    ]);
    const stored = repository.findByProjectAndCreationIdempotencyKey(
      project.id,
      'create-first-decision',
    );
    expect(stored).toMatchObject({
      id: details.id,
      context_version: 1,
      expected_context_item_count: 2,
      creation_idempotency_key: 'create-first-decision',
    });
    expect(stored?.creation_request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persists a search-enabled first turn and attributed assistant citations without exposing the internal flag', async () => {
    enableWebSearch();
    const project = createProject();
    const citations = [
      {
        url: 'https://example.com/current',
        title: 'Current source',
        snippet: 'Current source summary.',
      },
    ];
    modelClient.answerAttribution = {
      webSearchUsed: true,
      citations,
    };

    const created = await createDiscussion(project.id, 'What is current?', {
      idempotencyKey: 'create-current',
      webSearch: true,
    });

    expect(modelClient.answerInputs).toEqual([
      {
        formattedContext: contextFormatter.format(created.frozen_context),
        messages: [{ role: 'user', content: 'What is current?' }],
        webSearch: true,
      },
    ]);
    expect(created.messages[0]).not.toHaveProperty('web_search');
    expect(created.messages[1]).toMatchObject({
      role: 'assistant',
      web_search_used: true,
      citations,
    });
    expect(
      repository.findMessageByRequestId(
        project.id,
        created.id,
        created.messages[0].request_id!,
      ),
    ).toMatchObject({ web_search: true });
    expect(service.get(project.id, created.id)).toEqual(created);

    await expect(
      createDiscussion(project.id, 'What is current?', {
        idempotencyKey: 'create-current',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'DISCUSSION_CREATION_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('persists one and several documents with mixed selections in confirmed order', async () => {
    const project = createProject();
    const firstBubble = bubbles.create(project.id, {
      title: 'First bubble',
      content: 'Complete first bubble content.',
    });
    const secondBubble = bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Complete second bubble content.',
    });
    documents.results.set('document-a', {
      status: 'available',
      source: {
        id: 'document-a',
        project_id: project.id,
        title: 'First document',
        processing_status: 'ready',
        processed_text: 'Complete first document text.',
      },
    });
    documents.results.set('document-b', {
      status: 'available',
      source: {
        id: 'document-b',
        project_id: project.id,
        title: 'Second document',
        processing_status: 'ready',
        processed_text: 'Complete second document text.',
      },
    });

    const documentOnly = await createDiscussion(
      project.id,
      'Use one document',
      {
        documentIds: ['document-a'],
        idempotencyKey: 'create-one-document',
      },
    );
    const mixed = await createDiscussion(project.id, 'Use all sources', {
      bubbleIds: [secondBubble.id, firstBubble.id, secondBubble.id],
      documentIds: ['document-b', 'document-a', 'document-b'],
      idempotencyKey: 'create-mixed-context',
    });
    const documentOnlyContext = documentOnly.frozen_context as FrozenContextV1;
    const mixedContext = mixed.frozen_context as FrozenContextV1;

    expect(
      documentOnlyContext.items.map(
        ({ source_kind, source_id, frozen_content, display_order }) => ({
          source_kind,
          source_id,
          frozen_content,
          display_order,
        }),
      ),
    ).toEqual([
      {
        source_kind: 'project_description',
        source_id: project.id,
        frozen_content: project.description,
        display_order: 0,
      },
      {
        source_kind: 'document',
        source_id: 'document-a',
        frozen_content: 'Complete first document text.',
        display_order: 1,
      },
    ]);
    expect(
      mixedContext.items.map(
        ({ source_kind, source_id, source_title, display_order }) => ({
          source_kind,
          source_id,
          source_title,
          display_order,
        }),
      ),
    ).toEqual([
      {
        source_kind: 'project_description',
        source_id: project.id,
        source_title: 'Project description',
        display_order: 0,
      },
      {
        source_kind: 'bubble',
        source_id: secondBubble.id,
        source_title: secondBubble.title,
        display_order: 1,
      },
      {
        source_kind: 'bubble',
        source_id: firstBubble.id,
        source_title: firstBubble.title,
        display_order: 2,
      },
      {
        source_kind: 'document',
        source_id: 'document-b',
        source_title: 'Second document',
        display_order: 3,
      },
      {
        source_kind: 'document',
        source_id: 'document-a',
        source_title: 'First document',
        display_order: 4,
      },
    ]);
    expect(modelClient.answerInputs).toEqual([
      {
        formattedContext: contextFormatter.format(documentOnlyContext),
        messages: [{ role: 'user', content: 'Use one document' }],
      },
      {
        formattedContext: contextFormatter.format(mixedContext),
        messages: [{ role: 'user', content: 'Use all sources' }],
      },
    ]);
  });

  it('reuses persisted context after live sources are edited, renamed, or deleted', async () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Initial bubble title',
      content: 'Initial bubble content.',
    });
    projects.updateDescription(project.id, {
      description: 'Latest project description at confirmation.',
    });
    const latestBubble = bubbles.update(project.id, bubble.id, {
      title: 'Latest bubble title at confirmation',
      content: 'Latest bubble content at confirmation.',
    });
    documents.results.set('document-a', {
      status: 'available',
      source: {
        id: 'document-a',
        project_id: project.id,
        title: 'Latest document title at confirmation',
        processing_status: 'ready',
        processed_text: 'Latest document text at confirmation.',
      },
    });

    const created = await createDiscussion(
      project.id,
      'Freeze the latest values',
      {
        bubbleIds: [bubble.id],
        documentIds: ['document-a'],
        idempotencyKey: 'create-frozen-values',
      },
    );
    const frozenContext = created.frozen_context as FrozenContextV1;

    projects.updateDescription(project.id, {
      description: 'Changed after discussion creation.',
    });
    bubbles.update(project.id, bubble.id, {
      title: 'Renamed after discussion creation',
      content: 'Changed after discussion creation.',
    });
    bubbles.delete(project.id, bubble.id);
    documents.results.delete('document-a');

    const continued = await service.sendMessage(project.id, created.id, {
      content: 'Use the same frozen sources again',
      idempotency_key: 'reuse-frozen-context',
    });

    expect(frozenContext.items).toEqual([
      expect.objectContaining({
        source_kind: 'project_description',
        source_id: project.id,
        frozen_content: 'Latest project description at confirmation.',
      }),
      expect.objectContaining({
        source_kind: 'bubble',
        source_id: bubble.id,
        source_title: latestBubble.title,
        frozen_content: latestBubble.content,
      }),
      expect.objectContaining({
        source_kind: 'document',
        source_id: 'document-a',
        source_title: 'Latest document title at confirmation',
        frozen_content: 'Latest document text at confirmation.',
      }),
    ]);
    expect(continued.frozen_context).toEqual(frozenContext);
    expect(
      modelClient.answerInputs.map(({ formattedContext }) => formattedContext),
    ).toEqual([
      contextFormatter.format(frozenContext),
      contextFormatter.format(frozenContext),
    ]);
  });

  it('allows a failed document-readiness confirmation to retry coherently', async () => {
    const project = createProject();
    documents.results.set('document-a', {
      status: 'available',
      source: {
        id: 'document-a',
        project_id: project.id,
        title: 'Processing document',
        processing_status: 'processing',
        processed_text: null,
      },
    });

    await expect(
      createDiscussion(project.id, 'Wait for the complete document', {
        documentIds: ['document-a'],
        idempotencyKey: 'create-after-document-ready',
      }),
    ).rejects.toMatchObject({
      constructor: UnprocessableEntityException,
      response: {
        code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
        source_errors: [
          {
            source_kind: 'document',
            source_id: 'document-a',
            reason: 'processing',
          },
        ],
      },
    });
    expect(service.list(project.id)).toEqual([]);
    expect(modelClient.answerInputs).toEqual([]);

    documents.results.set('document-a', {
      status: 'available',
      source: {
        id: 'document-a',
        project_id: project.id,
        title: 'Ready document',
        processing_status: 'ready',
        processed_text: 'The complete processed document.',
      },
    });

    await expect(
      createDiscussion(project.id, 'Wait for the complete document', {
        documentIds: ['document-a'],
        idempotencyKey: 'create-after-document-ready',
      }),
    ).resolves.toMatchObject({
      frozen_context: {
        items: [
          expect.objectContaining({ source_kind: 'project_description' }),
          expect.objectContaining({
            source_kind: 'document',
            source_id: 'document-a',
            source_title: 'Ready document',
            frozen_content: 'The complete processed document.',
          }),
        ],
      },
    });
    expect(service.list(project.id)).toHaveLength(1);
    expect(modelClient.answerInputs).toHaveLength(1);
  });

  it.each([
    [
      {
        project_id: 'wrong-project',
        first_prompt: 'Valid prompt',
        idempotency_key: 'create-validation',
        bubble_ids: [],
        document_ids: [],
      },
      {
        project_id: 'Project id must match the project in the request path.',
      },
    ],
    [
      {
        project_id: 'PROJECT_ID',
        first_prompt: 'Valid prompt',
        idempotency_key: 'create-validation',
        bubble_ids: 'not-an-array',
        document_ids: [],
      },
      { bubble_ids: 'Bubble ids must be an array.' },
    ],
    [
      {
        project_id: 'PROJECT_ID',
        first_prompt: ' ',
        idempotency_key: 'create-validation',
        bubble_ids: [],
        document_ids: [],
      },
      { first_prompt: 'Message is required.' },
    ],
  ])(
    'rejects invalid creation input before persistence',
    async (input, errors) => {
      const project = createProject();
      const normalizedInput = {
        ...input,
        project_id:
          input.project_id === 'PROJECT_ID' ? project.id : input.project_id,
      };

      expect.assertions(3);

      try {
        await service.create(project.id, normalizedInput as never);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'DISCUSSION_VALIDATION_FAILED',
          message: 'Discussion input is invalid.',
          field_errors: errors,
        });
      }

      expect(service.list(project.id)).toEqual([]);
    },
  );

  it('validates the search flag and rejects search-enabled turns when the capability is unavailable', async () => {
    const project = createProject();

    await expect(
      service.create(project.id, {
        project_id: project.id,
        first_prompt: 'Malformed search choice',
        idempotency_key: 'malformed-search-choice',
        bubble_ids: [],
        document_ids: [],
        web_search: 'true',
      } as never),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: 'DISCUSSION_VALIDATION_FAILED',
        field_errors: {
          web_search: 'Web search must be a boolean.',
        },
      },
    });

    await expect(
      createDiscussion(project.id, 'Unavailable search', {
        idempotencyKey: 'unavailable-search',
        webSearch: true,
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: {
        code: 'AI_WEB_SEARCH_UNAVAILABLE',
        message: 'Web search is not available for this application.',
      },
    });
    expect(service.list(project.id)).toEqual([]);

    const created = await createDiscussion(project.id, 'Ordinary turn');
    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Unavailable follow-up search',
        idempotency_key: 'unavailable-follow-up-search',
        web_search: true,
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
      response: { code: 'AI_WEB_SEARCH_UNAVAILABLE' },
    });
    expect(service.get(project.id, created.id)).toEqual(created);
  });

  it('returns structured source errors without persisting a partial discussion', async () => {
    const project = createProject('Owner');
    const otherProject = createProject('Other');
    const otherBubble = bubbles.create(otherProject.id, {
      title: 'Private bubble',
      content: 'Content from another project.',
    });

    await expect(
      createDiscussion(project.id, 'Use selected context', {
        bubbleIds: ['missing-bubble', otherBubble.id],
        idempotencyKey: 'create-invalid-sources',
      }),
    ).rejects.toMatchObject({
      constructor: UnprocessableEntityException,
      response: {
        code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
        message:
          'One or more selected context sources are unavailable. Review or remove the affected selections.',
        source_errors: [
          {
            source_kind: 'bubble',
            source_id: 'missing-bubble',
            reason: 'missing',
          },
          {
            source_kind: 'bubble',
            source_id: otherBubble.id,
            reason: 'cross_project',
          },
        ],
      },
    });
    expect(service.list(project.id)).toEqual([]);
    expect(modelClient.answerInputs).toEqual([]);
  });

  it('replays matching creation requests and rejects conflicting idempotency reuse', async () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Selected bubble',
      content: 'Frozen on the first request.',
    });
    const input = {
      bubbleIds: [bubble.id, bubble.id],
      idempotencyKey: 'create-replay',
    };
    const first = await createDiscussion(project.id, 'Original prompt', input);

    bubbles.update(project.id, bubble.id, {
      title: 'Changed after creation',
      content: 'Changed after creation',
    });

    const replayed = await createDiscussion(
      project.id,
      '  Original prompt  ',
      input,
    );

    expect(replayed).toEqual(first);
    expect(service.list(project.id)).toHaveLength(1);
    expect(modelClient.answerInputs).toHaveLength(1);
    expect(
      (
        replayed.frozen_context as {
          items: Array<{ source_title: string; frozen_content: string }>;
        }
      ).items[1],
    ).toMatchObject({
      source_title: 'Selected bubble',
      frozen_content: 'Frozen on the first request.',
    });

    await expect(
      createDiscussion(project.id, 'Different prompt', {
        bubbleIds: [bubble.id],
        idempotencyKey: 'create-replay',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: {
        code: 'DISCUSSION_CREATION_IDEMPOTENCY_CONFLICT',
        message:
          'The creation idempotency key has already been used with a different prompt or context selection.',
      },
    });
    expect(service.list(project.id)).toHaveLength(1);
    expect(modelClient.answerInputs).toHaveLength(1);
  });

  it('translates atomic snapshot persistence failures without exposing storage details', async () => {
    const project = createProject();
    jest
      .spyOn(repository, 'createWithFirstMessage')
      .mockImplementationOnce(() => {
        throw new Error('SQLITE_CONSTRAINT: internal schema detail');
      });

    await expect(
      createDiscussion(project.id, 'Persist atomically', {
        idempotencyKey: 'create-persistence-failure',
      }),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: {
        code: 'DISCUSSION_SNAPSHOT_PERSISTENCE_FAILED',
        message:
          'The discussion and its frozen context could not be saved. Retry creation with the same idempotency key.',
      },
    });
    expect(service.list(project.id)).toEqual([]);
    expect(modelClient.answerInputs).toEqual([]);
  });

  it('lists latest activity as Active, records explicit open, and recalculates after deletion', async () => {
    const project = createProject();
    const first = await createDiscussion(project.id, 'First question');
    jest.setSystemTime(new Date('2026-07-27T11:00:00.000Z'));
    const second = await createDiscussion(project.id, 'Second question');

    expect(
      service.list(project.id).map(({ id, is_active }) => ({
        id,
        is_active,
      })),
    ).toEqual([
      { id: second.id, is_active: true },
      { id: first.id, is_active: false },
    ]);

    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));
    service.recordOpen(project.id, first.id);

    expect(
      service.list(project.id).map(({ id, is_active }) => ({
        id,
        is_active,
      })),
    ).toEqual([
      { id: first.id, is_active: true },
      { id: second.id, is_active: false },
    ]);

    service.delete(project.id, first.id);

    expect(service.list(project.id)).toEqual([
      expect.objectContaining({ id: second.id, is_active: true }),
    ]);
    expect(() => service.get(project.id, first.id)).toThrow(NotFoundException);
  });

  it('retains new and updated bubble provenance when their source discussion is deleted', async () => {
    const project = createProject();
    const createdDiscussion = await createDiscussion(
      project.id,
      'Which launch path is reversible?',
    );
    const sourceDiscussion = await service.generateTitle(
      project.id,
      createdDiscussion.id,
    );
    const sourceMessageId = sourceDiscussion.messages[1].id;
    const frozenContext = sourceDiscussion.frozen_context as FrozenContextV1;
    const sourceContextItemId = frozenContext.items[0]?.id;

    if (!sourceContextItemId) {
      throw new Error('Expected versioned frozen discussion context.');
    }

    const createdResult = bubbles.createFromDiscussionExtraction({
      project_id: project.id,
      extraction_id: 'extraction-created',
      source_discussion_id: sourceDiscussion.id,
      source_discussion_title: sourceDiscussion.title,
      source_message_ids: [sourceMessageId],
      source_context_item_ids: [sourceContextItemId],
      title: 'Reversible launch path',
      summary: 'Choose the option that preserves reversibility.',
      content: 'Sequence the launch so the uncertain decision can be reversed.',
    });
    const updateTarget = bubbles.create(project.id, {
      title: 'Earlier launch guidance',
      content: 'An earlier draft of the launch guidance.',
    });
    const updatedResult = bubbles.updateFromDiscussionExtraction({
      project_id: project.id,
      extraction_id: 'extraction-updated',
      bubble_id: updateTarget.id,
      expected_updated_at: updateTarget.updated_at,
      source_discussion_id: sourceDiscussion.id,
      source_discussion_title: sourceDiscussion.title,
      source_message_ids: [sourceMessageId],
      source_context_item_ids: [],
      title: 'Reviewed launch guidance',
      summary: null,
      content: 'Preserve the revised, reviewed launch guidance.',
    });

    if (
      createdResult.status !== 'created' ||
      updatedResult.status !== 'updated'
    ) {
      throw new Error('Expected both extraction resolutions to persist.');
    }

    const createdBubbleBefore = createdResult.bubble;
    const updatedBubbleBefore = updatedResult.bubble;
    jest.setSystemTime(new Date('2026-07-27T12:00:00.000Z'));

    service.delete(project.id, sourceDiscussion.id);

    expect(bubbles.get(project.id, createdBubbleBefore.id)).toEqual({
      ...createdBubbleBefore,
      source_discussion_deleted_at: '2026-07-27T12:00:00.000Z',
    });
    expect(bubbles.get(project.id, updatedBubbleBefore.id)).toEqual({
      ...updatedBubbleBefore,
      source_discussion_deleted_at: '2026-07-27T12:00:00.000Z',
    });
    expect(() => service.get(project.id, sourceDiscussion.id)).toThrow(
      NotFoundException,
    );
    expect(
      Object.keys(bubbles.get(project.id, createdBubbleBefore.id)),
    ).not.toContain('source_transcript');
  });

  it('rolls back discussion deletion when provenance availability cannot be persisted', async () => {
    const project = createProject();
    const sourceDiscussion = await createDiscussion(
      project.id,
      'Keep deletion atomic',
    );
    const sourceBubbleResult = bubbles.createFromDiscussionExtraction({
      project_id: project.id,
      extraction_id: 'extraction-rollback',
      source_discussion_id: sourceDiscussion.id,
      source_discussion_title: 'Atomic deletion source',
      source_message_ids: [sourceDiscussion.messages[1].id],
      source_context_item_ids: [],
      title: 'Atomic knowledge',
      summary: null,
      content: 'This bubble and its source availability change together.',
    });

    if (sourceBubbleResult.status !== 'created') {
      throw new Error('Expected the extraction bubble to persist.');
    }

    const markSourceDiscussionDeleted =
      bubbleRepository.markSourceDiscussionDeleted.bind(bubbleRepository);
    jest
      .spyOn(bubbleRepository, 'markSourceDiscussionDeleted')
      .mockImplementationOnce((...args) => {
        markSourceDiscussionDeleted(...args);
        throw new Error('Simulated provenance persistence failure.');
      });

    expect(() => service.delete(project.id, sourceDiscussion.id)).toThrow(
      'Simulated provenance persistence failure.',
    );
    expect(service.get(project.id, sourceDiscussion.id)).toEqual(
      sourceDiscussion,
    );
    expect(bubbles.get(project.id, sourceBubbleResult.bubble.id)).toEqual(
      sourceBubbleResult.bubble,
    );
  });

  it('sends complete history and makes completed submissions idempotent', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    jest.setSystemTime(new Date('2026-07-27T10:05:00.000Z'));

    const sent = await service.sendMessage(project.id, created.id, {
      content: '  Follow-up question  ',
      idempotency_key: 'request-follow-up',
    });
    const replayed = await service.sendMessage(project.id, created.id, {
      content: 'Follow-up question',
      idempotency_key: 'request-follow-up',
    });

    expect(sent.messages).toHaveLength(4);
    expect(replayed).toEqual(sent);
    expect(modelClient.answerInputs).toHaveLength(2);
    expect(modelClient.answerInputs[1]).toEqual({
      formattedContext: contextFormatter.format(created.frozen_context),
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'A focused answer.' },
        { role: 'user', content: 'Follow-up question' },
      ],
    });
  });

  it('generates and persists a single-line title after the first completed exchange', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    modelClient.title = '  Launch\n sequencing   risks  ';
    jest.setSystemTime(new Date('2026-07-27T10:05:00.000Z'));

    const titled = await service.generateTitle(project.id, created.id);

    expect(titled).toMatchObject({
      id: created.id,
      title: 'Launch sequencing risks',
      updated_at: '2026-07-27T10:05:00.000Z',
      last_activity_at: created.last_activity_at,
    });
    expect(modelClient.titleInputs).toEqual([
      {
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'A focused answer.' },
        ],
      },
    ]);
    expect(service.list(project.id)).toEqual([
      expect.objectContaining({
        id: created.id,
        title: 'Launch sequencing risks',
        is_active: true,
      }),
    ]);
  });

  it('does not call the model again when a discussion is already titled', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id);
    const first = await service.generateTitle(project.id, created.id);
    modelClient.title = 'A different title';

    const replayed = await service.generateTitle(project.id, created.id);

    expect(replayed).toEqual(first);
    expect(modelClient.titleInputs).toHaveLength(1);
  });

  it('coalesces concurrent title requests into one model generation', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id);
    let resolveTitle!: (generation: ModelGeneration) => void;
    modelClient.titleGeneration = new Promise((resolve) => {
      resolveTitle = resolve;
    });

    const firstRequest = service.generateTitle(project.id, created.id);
    const duplicateRequest = service.generateTitle(project.id, created.id);

    expect(modelClient.titleInputs).toHaveLength(1);
    resolveTitle({
      content: 'Coalesced title',
      model: 'test-model',
    });

    const [first, duplicate] = await Promise.all([
      firstRequest,
      duplicateRequest,
    ]);
    expect(duplicate).toEqual(first);
    expect(first.title).toBe('Coalesced title');
  });

  it('leaves the placeholder title usable when generation fails and allows retry', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id);
    modelClient.titleFailure = new Error('provider unavailable');

    await expect(
      service.generateTitle(project.id, created.id),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: {
        code: 'AI_TITLE_GENERATION_FAILED',
        message:
          'The discussion title could not be generated. Retry title generation.',
        discussion_id: created.id,
      },
    });
    expect(service.get(project.id, created.id).title).toBe('New discussion');

    modelClient.titleFailure = undefined;
    await expect(
      service.generateTitle(project.id, created.id),
    ).resolves.toMatchObject({
      title: 'Generated discussion title',
    });
    expect(modelClient.titleInputs).toHaveLength(2);
  });

  it('rejects title generation before an exchange is complete', async () => {
    const project = createProject();
    const timestamp = new Date().toISOString();
    repository.createWithFirstMessage(
      {
        id: 'pending-discussion',
        project_id: project.id,
        title: null,
        frozen_context: {},
        created_at: timestamp,
        updated_at: timestamp,
        last_activity_at: timestamp,
        deleted_at: null,
        context_version: null,
        expected_context_item_count: null,
        creation_idempotency_key: null,
        creation_request_fingerprint: null,
      },
      {
        id: 'pending-message',
        discussion_id: 'pending-discussion',
        role: 'user',
        content: 'Still waiting',
        created_at: timestamp,
        status: 'pending',
        request_id: 'pending-request',
      },
    );

    await expect(
      service.generateTitle(project.id, 'pending-discussion'),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: {
        code: 'DISCUSSION_TITLE_NOT_READY',
        message:
          'A title can be generated after the first response is completed.',
      },
    });
    expect(modelClient.titleInputs).toHaveLength(0);
  });

  it.each(['', 'x'.repeat(61)])(
    'rejects invalid generated titles without persisting them',
    async (title) => {
      const project = createProject();
      const created = await createDiscussion(project.id);
      modelClient.title = title;

      await expect(
        service.generateTitle(project.id, created.id),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(service.get(project.id, created.id).title).toBe('New discussion');
    },
  );

  it('preserves a failed user turn and retries it without duplicating messages', async () => {
    enableWebSearch();
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    modelClient.answerFailure = new Error('provider unavailable');

    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Question that fails',
        idempotency_key: 'failed-request',
        web_search: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const failed = service.get(project.id, created.id);
    expect(failed.messages).toHaveLength(3);
    expect(failed.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Question that fails',
      status: 'failed',
      request_id: 'failed-request',
    });
    expect(
      repository.findMessageByRequestId(
        project.id,
        created.id,
        'failed-request',
      ),
    ).toMatchObject({ web_search: true });

    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Question that fails',
        idempotency_key: 'failed-request',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'DISCUSSION_IDEMPOTENCY_CONFLICT' },
    });

    modelClient.answerFailure = undefined;
    modelClient.answerAttribution = {
      webSearchUsed: true,
      citations: [],
    };
    const retried = await service.sendMessage(project.id, created.id, {
      content: 'Question that fails',
      idempotency_key: 'failed-request',
      web_search: true,
    });

    expect(retried.messages).toHaveLength(4);
    expect(retried.messages.slice(-2)).toEqual([
      expect.objectContaining({
        role: 'user',
        status: 'completed',
        request_id: 'failed-request',
      }),
      expect.objectContaining({
        role: 'assistant',
        status: 'completed',
        request_id: null,
        web_search_used: true,
        citations: [],
      }),
    ]);
    expect(modelClient.answerInputs.slice(-2)).toEqual([
      expect.objectContaining({ webSearch: true }),
      expect.objectContaining({ webSearch: true }),
    ]);
  });

  it('fails a searched turn without persisting an assistant message when citations exceed the guard', async () => {
    enableWebSearch();
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    modelClient.answerAttribution = {
      webSearchUsed: true,
      citations: [
        {
          url: 'https://example.com/oversized',
          title: 'Oversized citation',
          snippet: 'x'.repeat(64 * 1024),
        },
      ],
    };

    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Search with oversized attribution',
        idempotency_key: 'oversized-attribution',
        web_search: true,
      }),
    ).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: { code: 'AI_GENERATION_FAILED' },
    });

    expect(service.get(project.id, created.id).messages.slice(-1)).toEqual([
      expect.objectContaining({
        role: 'user',
        status: 'failed',
        request_id: 'oversized-attribution',
      }),
    ]);
  });

  it('returns recovery identifiers when first-answer generation fails', async () => {
    const project = createProject();
    modelClient.answerFailure = new Error('provider unavailable');

    try {
      await createDiscussion(project.id, 'Persist this question');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (
        error as ServiceUnavailableException
      ).getResponse() as Record<string, unknown>;
      expect(response).toMatchObject({
        code: 'AI_GENERATION_FAILED',
        message:
          'The response could not be generated. Retry the unanswered message.',
      });
      expect(response.discussion_id).toEqual(expect.any(String));
      expect(response.request_id).toEqual(expect.any(String));
    }

    const [summary] = service.list(project.id);
    const failed = service.get(project.id, summary.id);
    expect(failed.messages).toHaveLength(1);
    expect(failed.messages[0].request_id).toEqual(expect.any(String));
    expect(failed.messages[0]).toMatchObject({
      role: 'user',
      content: 'Persist this question',
      status: 'failed',
    });
    expect(summary.is_active).toBe(true);
  });

  it('returns a timeout-specific recovery error when answer generation times out', async () => {
    enableWebSearch();
    const project = createProject();
    modelClient.answerFailure = new ModelGenerationError('timeout');

    try {
      await createDiscussion(project.id, 'Search for current information', {
        idempotencyKey: 'timed-out-search',
        webSearch: true,
      });
      throw new Error('Expected answer generation to time out.');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (
        error as ServiceUnavailableException
      ).getResponse() as Record<string, unknown>;
      expect(response).toMatchObject({
        code: 'AI_GENERATION_TIMEOUT',
        message:
          'The response took too long to generate. Retry the unanswered message.',
      });
      expect(typeof response.discussion_id).toBe('string');
      expect(typeof response.request_id).toBe('string');
    }

    const [summary] = service.list(project.id);
    expect(service.get(project.id, summary.id).messages).toEqual([
      expect.objectContaining({
        role: 'user',
        status: 'failed',
      }),
    ]);
  });

  it('rejects idempotency-key reuse with different content', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id);

    await service.sendMessage(project.id, created.id, {
      content: 'Original content',
      idempotency_key: 'same-key',
    });

    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Different content',
        idempotency_key: 'same-key',
      }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
    });
  });

  it('rejects an over-budget first turn before persistence', async () => {
    const project = createProject();
    modelInputBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit: 12_001,
        reservedOutputTokens: 4_000,
        inputSafetyMarginTokens: 8_000,
      },
      new ConservativeInputTokenEstimator(),
    );
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
      contextFormatter,
      modelInputBudget,
      contextAssembler,
      bubbleRepository,
      transactions,
      { web_search: false },
    );

    try {
      await createDiscussion(project.id, 'Question', {
        idempotencyKey: 'create-over-budget',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PayloadTooLargeException);
      const response = (
        error as PayloadTooLargeException
      ).getResponse() as Record<string, unknown>;

      expect(response).toMatchObject({
        code: 'DISCUSSION_CONTEXT_TOO_LARGE',
        message:
          'The frozen context and complete message history exceed the supported model input budget. Remove selected context or start a new discussion.',
        available_input_tokens: 1,
        input_token_limit: 12_001,
        reserved_output_tokens: 4_000,
        safety_margin_tokens: 8_000,
      });
      expect(typeof response.estimated_input_tokens).toBe('number');
    }

    expect(service.list(project.id)).toEqual([]);
  });

  it('blocks a later message before persistence when complete history no longer fits', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    const nextContent = 'A follow-up that pushes the history over budget.';
    const prospectiveMessages = [
      ...created.messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: nextContent },
    ];
    const measurement = modelInputBudget.evaluateAnswer({
      formattedContext: contextFormatter.format(created.frozen_context),
      messages: prospectiveMessages,
    });
    const tightBudget = new ConfiguredModelInputBudget(
      {
        focusedResponseWordBudget: 200,
        modelInputTokenLimit:
          measurement.estimatedInputTokens + 4_000 + 8_000 - 1,
        reservedOutputTokens: 4_000,
        inputSafetyMarginTokens: 8_000,
      },
      new ConservativeInputTokenEstimator(),
    );
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
      contextFormatter,
      tightBudget,
      contextAssembler,
      bubbleRepository,
      transactions,
      { web_search: false },
    );

    await expect(
      service.sendMessage(project.id, created.id, {
        content: nextContent,
        idempotency_key: 'over-budget-follow-up',
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(service.get(project.id, created.id).messages).toEqual(
      created.messages,
    );
    expect(modelClient.answerInputs).toHaveLength(1);
  });

  it('does not expose discussions through another project route', async () => {
    const owner = createProject('Owner');
    const other = createProject('Other');
    const discussion = await createDiscussion(owner.id);

    expect(service.list(other.id)).toEqual([]);
    expect(() => service.get(other.id, discussion.id)).toThrow(
      NotFoundException,
    );
    await expect(
      service.sendMessage(other.id, discussion.id, {
        content: 'Cross-project message',
        idempotency_key: 'cross-project',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.generateTitle(other.id, discussion.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
