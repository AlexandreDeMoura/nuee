import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  AiCapabilities,
  Bubble,
  DiscussionDetails,
  DiscussionListResponse,
  FrozenContextV1,
  Project,
} from '@nuee/shared-types';
import { AppModule } from './../src/app.module';
import { AI_CAPABILITIES } from './../src/ai/ai-capabilities';
import { FAKE_WEB_SEARCH_CITATIONS } from './../src/ai/fake-model.client';

describe('Discussion lifecycle journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-discussion-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'discussions.sqlite');
  const previousDatabasePath = process.env.PROJECT_DATABASE_PATH;
  let app: INestApplication<App> | undefined;

  async function startApplication(
    capabilities?: AiCapabilities,
  ): Promise<INestApplication<App>> {
    process.env.PROJECT_DATABASE_PATH = databasePath;
    const builder = Test.createTestingModule({
      imports: [AppModule],
    });

    if (capabilities) {
      builder.overrideProvider(AI_CAPABILITIES).useValue(capabilities);
    }

    const moduleFixture: TestingModule = await builder.compile();
    const application = moduleFixture.createNestApplication();
    await application.init();
    return application;
  }

  async function createProject(title: string): Promise<Project> {
    const response = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title,
        description: `Description for ${title}.`,
      })
      .expect(201);

    return response.body as Project;
  }

  async function createDiscussion(
    project: Project,
    prompt: string,
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
  ): Promise<DiscussionDetails> {
    const response = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: prompt,
        idempotency_key: idempotencyKey,
        bubble_ids: bubbleIds,
        document_ids: documentIds,
        ...(webSearch ? { web_search: true } : {}),
      })
      .expect(201);

    return response.body as DiscussionDetails;
  }

  beforeEach(async () => {
    app = await startApplication();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(() => {
    if (previousDatabasePath === undefined) {
      delete process.env.PROJECT_DATABASE_PATH;
    } else {
      process.env.PROJECT_DATABASE_PATH = previousDatabasePath;
    }

    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('creates, messages, replays, opens, reloads, scopes, and deletes discussions', async () => {
    const project = await createProject('Discussion owner');
    const otherProject = await createProject('Other project');
    const bubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Launch constraint',
        content: 'The launch must remain reversible.',
      })
      .expect(201);
    const bubble = bubbleResponse.body as Bubble;
    const first = await createDiscussion(project, 'What is the first risk?', {
      bubbleIds: [bubble.id, bubble.id],
      idempotencyKey: 'create-first-risk',
    });

    expect(first).toMatchObject({
      project_id: project.id,
      title: 'New discussion',
      frozen_context: {
        version: 1,
        items: [
          {
            source_kind: 'project_description',
            source_id: project.id,
            frozen_content: project.description,
            display_order: 0,
          },
          {
            source_kind: 'bubble',
            source_id: bubble.id,
            source_title: bubble.title,
            frozen_content: bubble.content,
            display_order: 1,
          },
        ],
      },
      messages: [
        {
          role: 'user',
          content: 'What is the first risk?',
          status: 'completed',
        },
        {
          role: 'assistant',
          content: 'Deterministic answer: What is the first risk?',
          status: 'completed',
        },
      ],
    });

    await createDiscussion(project, 'What is the first risk?', {
      bubbleIds: [bubble.id],
      idempotencyKey: 'create-first-risk',
    }).then((replayed) => expect(replayed).toEqual(first));

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'A conflicting prompt',
        idempotency_key: 'create-first-risk',
        bubble_ids: [bubble.id],
        document_ids: [],
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'DISCUSSION_CREATION_IDEMPOTENCY_CONFLICT',
        });
      });

    const titleResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${first.id}/title`)
      .expect(200);
    const titled = titleResponse.body as DiscussionDetails;
    expect(titled).toMatchObject({
      id: first.id,
      title: 'What is the first risk?',
    });

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${first.id}/title`)
      .expect(200)
      .expect(titled);

    const messageResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${first.id}/messages`)
      .send({
        content: 'What should happen next?',
        idempotency_key: 'follow-up-request',
      })
      .expect(200);
    const messaged = messageResponse.body as DiscussionDetails;

    expect(messaged.messages).toHaveLength(4);
    expect(messaged.messages.slice(-2)).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'What should happen next?',
        request_id: 'follow-up-request',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Deterministic answer: What should happen next?',
        request_id: null,
      }),
    ]);

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${first.id}/messages`)
      .send({
        content: 'What should happen next?',
        idempotency_key: 'follow-up-request',
      })
      .expect(200)
      .expect(messaged);

    const second = await createDiscussion(project, 'A separate question');
    const initialListResponse = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions`)
      .expect(200);
    const initialList = initialListResponse.body as DiscussionListResponse;
    expect(initialList.map(({ id, is_active }) => ({ id, is_active }))).toEqual(
      [
        { id: second.id, is_active: true },
        { id: first.id, is_active: false },
      ],
    );

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${first.id}/open`)
      .expect(200);
    const openedListResponse = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions`)
      .expect(200);
    const openedList = openedListResponse.body as DiscussionListResponse;
    expect(openedList.map(({ id, is_active }) => ({ id, is_active }))).toEqual([
      { id: first.id, is_active: true },
      { id: second.id, is_active: false },
    ]);

    await request(app!.getHttpServer())
      .get(`/projects/${otherProject.id}/discussions/${first.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'DISCUSSION_NOT_FOUND' });
      });
    await request(app!.getHttpServer())
      .get(`/projects/${otherProject.id}/discussions`)
      .expect(200)
      .expect([]);

    await app!.close();
    app = await startApplication();

    const reloadedResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${first.id}`)
      .expect(200);
    expect(reloadedResponse.body).toMatchObject({
      id: first.id,
      title: 'What is the first risk?',
      messages: messaged.messages,
    });

    await request(app.getHttpServer())
      .delete(`/projects/${project.id}/discussions/${first.id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${first.id}`)
      .expect(404);
    const remainingListResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions`)
      .expect(200);
    expect(remainingListResponse.body).toEqual([
      expect.objectContaining({ id: second.id, is_active: true }),
    ]);
  });

  it('freezes project-only and ordered multi-bubble context across source changes and reloads', async () => {
    const project = await createProject('Frozen context owner');
    const projectOnly = await createDiscussion(
      project,
      'Use only the project description',
      { idempotencyKey: 'create-project-only-context' },
    );

    expect(projectOnly.frozen_context).toMatchObject({
      version: 1,
      items: [
        {
          source_kind: 'project_description',
          source_id: project.id,
          source_title: 'Project description',
          frozen_content: project.description,
          display_order: 0,
        },
      ],
    });

    const updatedProjectResponse = await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/description`)
      .send({ description: 'Latest description at confirmation.' })
      .expect(200);
    const projectAtConfirmation = updatedProjectResponse.body as Project;
    const firstBubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'First source',
        content: 'Initial first content.',
        position_x: 120,
        position_y: -40,
      })
      .expect(201);
    const firstBubble = firstBubbleResponse.body as Bubble;
    const updatedFirstBubbleResponse = await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/bubbles/${firstBubble.id}`)
      .send({
        title: 'First source at confirmation',
        content: 'Latest first content at confirmation.',
      })
      .expect(200);
    const firstBubbleAtConfirmation = updatedFirstBubbleResponse.body as Bubble;
    const secondBubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Second source at confirmation',
        content: 'Second content at confirmation.',
        position_x: -75,
        position_y: 30,
      })
      .expect(201);
    const secondBubbleAtConfirmation = secondBubbleResponse.body as Bubble;

    const created = await createDiscussion(
      projectAtConfirmation,
      'Use the confirmed sources',
      {
        bubbleIds: [
          secondBubbleAtConfirmation.id,
          firstBubbleAtConfirmation.id,
          secondBubbleAtConfirmation.id,
        ],
        idempotencyKey: 'create-multi-bubble-context',
      },
    );
    const frozenContext = created.frozen_context as FrozenContextV1;

    expect(
      frozenContext.items.map(
        ({
          source_kind,
          source_id,
          source_title,
          frozen_content,
          display_order,
        }) => ({
          source_kind,
          source_id,
          source_title,
          frozen_content,
          display_order,
        }),
      ),
    ).toEqual([
      {
        source_kind: 'project_description',
        source_id: project.id,
        source_title: 'Project description',
        frozen_content: projectAtConfirmation.description,
        display_order: 0,
      },
      {
        source_kind: 'bubble',
        source_id: secondBubbleAtConfirmation.id,
        source_title: secondBubbleAtConfirmation.title,
        frozen_content: secondBubbleAtConfirmation.content,
        display_order: 1,
      },
      {
        source_kind: 'bubble',
        source_id: firstBubbleAtConfirmation.id,
        source_title: firstBubbleAtConfirmation.title,
        frozen_content: firstBubbleAtConfirmation.content,
        display_order: 2,
      },
    ]);

    await request(app!.getHttpServer())
      .get(`/projects/${project.id}`)
      .expect(200)
      .expect(projectAtConfirmation);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles/${firstBubbleAtConfirmation.id}`)
      .expect(200)
      .expect(firstBubbleAtConfirmation);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles/${secondBubbleAtConfirmation.id}`)
      .expect(200)
      .expect(secondBubbleAtConfirmation);

    await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/description`)
      .send({ description: 'Changed after discussion creation.' })
      .expect(200);
    await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/bubbles/${secondBubbleAtConfirmation.id}`)
      .send({
        title: 'Renamed after discussion creation',
        content: 'Changed after discussion creation.',
      })
      .expect(200);
    await request(app!.getHttpServer())
      .delete(`/projects/${project.id}/bubbles/${firstBubbleAtConfirmation.id}`)
      .expect(204);

    const continuedResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${created.id}/messages`)
      .send({
        content: 'Continue with the original frozen context',
        idempotency_key: 'continue-with-frozen-context',
      })
      .expect(200);
    const continued = continuedResponse.body as DiscussionDetails;
    expect(continued.frozen_context).toEqual(frozenContext);

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${created.id}`)
      .expect(200)
      .expect((response) => {
        const reloaded = response.body as DiscussionDetails;
        expect(reloaded.frozen_context).toEqual(frozenContext);
      });

    await request(app.getHttpServer())
      .delete(`/projects/${project.id}/discussions/${created.id}`)
      .expect(204);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${created.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'DISCUSSION_NOT_FOUND' });
      });
  });

  it('rejects unavailable and cross-project selections without partial persistence', async () => {
    const project = await createProject('Context selection owner');
    const otherProject = await createProject('Context selection outsider');
    const deletedBubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Deleted before confirmation',
        content: 'This source will disappear.',
      })
      .expect(201);
    const deletedBubble = deletedBubbleResponse.body as Bubble;
    const otherBubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${otherProject.id}/bubbles`)
      .send({
        title: 'Other project source',
        content: 'This source belongs elsewhere.',
      })
      .expect(201);
    const otherBubble = otherBubbleResponse.body as Bubble;

    await request(app!.getHttpServer())
      .delete(`/projects/${project.id}/bubbles/${deletedBubble.id}`)
      .expect(204);
    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'Reject invalid context atomically',
        idempotency_key: 'retry-invalid-context',
        bubble_ids: [deletedBubble.id, otherBubble.id],
        document_ids: ['document-reader-unavailable'],
      })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: 'DISCUSSION_CONTEXT_SOURCE_INVALID',
          message:
            'One or more selected context sources are unavailable. Review or remove the affected selections.',
          source_errors: [
            {
              source_kind: 'bubble',
              source_id: deletedBubble.id,
              reason: 'missing',
            },
            {
              source_kind: 'bubble',
              source_id: otherBubble.id,
              reason: 'cross_project',
            },
            {
              source_kind: 'document',
              source_id: 'document-reader-unavailable',
              reason: 'missing',
            },
          ],
        });
      });
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions`)
      .expect(200)
      .expect([]);

    await createDiscussion(project, 'Reject invalid context atomically', {
      idempotencyKey: 'retry-invalid-context',
    }).then((retried) => {
      expect(retried.frozen_context).toMatchObject({
        version: 1,
        items: [
          {
            source_kind: 'project_description',
            source_id: project.id,
            display_order: 0,
          },
        ],
      });
    });
  });

  it('returns stable validation errors', async () => {
    const project = await createProject('Validation');

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: '   ',
        idempotency_key: 'create-invalid',
        bubble_ids: [],
        document_ids: [],
      })
      .expect(400)
      .expect({
        code: 'DISCUSSION_VALIDATION_FAILED',
        message: 'Discussion input is invalid.',
        field_errors: {
          first_prompt: 'Message is required.',
        },
      });

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'Valid question',
        idempotency_key: 'create-unknown-field',
        bubble_ids: [],
        document_ids: [],
        current_project_description: 'Must not replace frozen context.',
      })
      .expect(400)
      .expect({
        code: 'DISCUSSION_VALIDATION_FAILED',
        message: 'Discussion input is invalid.',
        field_errors: {
          current_project_description: 'Unknown field.',
        },
      });
  });

  it('exposes capabilities, rejects unavailable search, and reloads persisted search attribution', async () => {
    await request(app!.getHttpServer())
      .get('/ai-capabilities')
      .expect(200)
      .expect({ web_search: false });

    const project = await createProject('Search capability');
    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'Search while unavailable',
        idempotency_key: 'search-unavailable',
        bubble_ids: [],
        document_ids: [],
        web_search: true,
      })
      .expect(400)
      .expect({
        code: 'AI_WEB_SEARCH_UNAVAILABLE',
        message: 'Web search is not available for this application.',
      });

    await app!.close();
    app = await startApplication({ web_search: true });
    await request(app.getHttpServer())
      .get('/ai-capabilities')
      .expect(200)
      .expect({ web_search: true });

    const searched = await createDiscussion(project, 'What is current?', {
      idempotencyKey: 'search-enabled',
      webSearch: true,
    });
    expect(searched.messages[0]).not.toHaveProperty('web_search');
    expect(searched.messages[1]).toMatchObject({
      role: 'assistant',
      web_search_used: true,
      citations: FAKE_WEB_SEARCH_CITATIONS,
    });

    await app.close();
    app = await startApplication({ web_search: true });
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${searched.id}`)
      .expect(200)
      .expect(searched);

    await request(app.getHttpServer())
      .post(`/projects/${project.id}/discussions/${searched.id}/messages`)
      .send({
        content: 'Search again after restart',
        idempotency_key: 'search-after-restart',
        web_search: true,
      })
      .expect(200)
      .expect(({ body }) => {
        const reloaded = body as DiscussionDetails;
        expect(reloaded.messages.at(-1)).toMatchObject({
          role: 'assistant',
          web_search_used: true,
          citations: FAKE_WEB_SEARCH_CITATIONS,
        });
      });
  });
});
