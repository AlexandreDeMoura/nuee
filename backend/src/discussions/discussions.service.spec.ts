import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  GenerateAnswerInput,
  ModelClient,
  ModelGeneration,
} from '../ai/model-client';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { DiscussionsService } from './discussions.service';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

class ControllableModelClient implements ModelClient {
  readonly answerInputs: GenerateAnswerInput[] = [];
  answer = 'A focused answer.';
  failure: Error | undefined;

  generateAnswer(input: GenerateAnswerInput): Promise<ModelGeneration> {
    this.answerInputs.push(input);

    if (this.failure) {
      return Promise.reject(this.failure);
    }

    return Promise.resolve({
      content: this.answer,
      model: 'test-model',
    });
  }

  generateTitle(): Promise<ModelGeneration> {
    return Promise.resolve({
      content: 'Unused title',
      model: 'test-model',
    });
  }
}

describe('DiscussionsService', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteDiscussionRepository;
  let modelClient: ControllableModelClient;
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
    service = new DiscussionsService(
      projects,
      repository,
      repository,
      modelClient,
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
        frozenContext: details.frozen_context,
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
      frozenContext: created.frozen_context,
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'A focused answer.' },
        { role: 'user', content: 'Follow-up question' },
      ],
    });
  });

  it('preserves a failed user turn and retries it without duplicating messages', async () => {
    const project = createProject();
    const created = await createDiscussion(project.id, 'First question');
    modelClient.failure = new Error('provider unavailable');

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

    modelClient.failure = undefined;
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
    modelClient.failure = new Error('provider unavailable');

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

    await expect(
      service.create(project.id, {
        project_id: project.id,
        frozen_context: { content: 'x'.repeat(250_000) },
        first_prompt: 'Question',
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(service.list(project.id)).toEqual([]);
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
  });
});
