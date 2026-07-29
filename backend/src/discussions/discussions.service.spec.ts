import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CanonicalFrozenContextFormatter } from '../ai/frozen-context.formatter';
import { ConservativeInputTokenEstimator } from '../ai/input-token-estimator';
import type {
  GenerateAnswerInput,
  GenerateTitleInput,
  ModelClient,
  ModelGeneration,
} from '../ai/model-client';
import { ConfiguredModelInputBudget } from '../ai/model-input-budget';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { DiscussionsService } from './discussions.service';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

class ControllableModelClient implements ModelClient {
  readonly answerInputs: GenerateAnswerInput[] = [];
  readonly titleInputs: GenerateTitleInput[] = [];
  answer = 'A focused answer.';
  title = 'Generated discussion title';
  answerFailure: Error | undefined;
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
  let repository: SqliteDiscussionRepository;
  let modelClient: ControllableModelClient;
  let contextFormatter: CanonicalFrozenContextFormatter;
  let modelInputBudget: ConfiguredModelInputBudget;
  let service: DiscussionsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-27T10:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
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
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
      contextFormatter,
      modelInputBudget,
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

  async function createDiscussion(projectId: string, prompt = 'First?') {
    return service.create(projectId, {
      project_id: projectId,
      frozen_context: {
        project_description: {
          content: 'A frozen project description.',
        },
      },
      first_prompt: prompt,
    });
  }

  it('atomically creates the first turn and forwards frozen context to the model', async () => {
    const project = createProject();
    const details = await createDiscussion(
      project.id,
      '  What should we decide first?  ',
    );

    expect(details).toMatchObject({
      project_id: project.id,
      title: 'New discussion',
      frozen_context: {
        project_description: {
          content: 'A frozen project description.',
        },
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
  });

  it.each([
    [
      {
        project_id: 'wrong-project',
        frozen_context: {},
        first_prompt: 'Valid prompt',
      },
      {
        project_id: 'Project id must match the project in the request path.',
      },
    ],
    [
      {
        project_id: 'PROJECT_ID',
        frozen_context: [],
        first_prompt: 'Valid prompt',
      },
      { frozen_context: 'Frozen context must be a JSON object.' },
    ],
    [
      {
        project_id: 'PROJECT_ID',
        frozen_context: {},
        first_prompt: ' ',
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
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    modelClient.answerFailure = new Error('provider unavailable');

    await expect(
      service.sendMessage(project.id, created.id, {
        content: 'Question that fails',
        idempotency_key: 'failed-request',
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

    modelClient.answerFailure = undefined;
    const retried = await service.sendMessage(project.id, created.id, {
      content: 'Question that fails',
      idempotency_key: 'failed-request',
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

  it('rejects oversized context without silently truncating it', async () => {
    const project = createProject();

    try {
      await service.create(project.id, {
        project_id: project.id,
        frozen_context: { content: 'x'.repeat(400_000) },
        first_prompt: 'Question',
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
        available_input_tokens: 116_000,
        input_token_limit: 128_000,
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
