import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  Bubble,
  DiscussionDetails,
  FrozenContextV1,
  KnowledgeExtractionProposalResponse,
  KnowledgeExtractionResolutionResponse,
  Project,
} from '@nuee/shared-types';
import { AppModule } from './../src/app.module';

describe('Knowledge extraction generation journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-extraction-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'extractions.sqlite');
  const previousDatabasePath = process.env.PROJECT_DATABASE_PATH;
  let app: INestApplication<App> | undefined;

  async function startApplication(): Promise<INestApplication<App>> {
    process.env.PROJECT_DATABASE_PATH = databasePath;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const application = moduleFixture.createNestApplication();
    await application.init();
    return application;
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

  it('generates, replays, reloads, and scopes one structured proposal without changing the discussion', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Extraction owner',
        description: 'The proposal must remain grounded.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const otherProjectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Extraction outsider',
        description: 'A different project.',
      })
      .expect(201);
    const otherProject = otherProjectResponse.body as Project;
    const discussionResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'What conclusion should become durable knowledge?',
        idempotency_key: 'create-extraction-source',
        bubble_ids: [],
        document_ids: [],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const frozenContext = discussion.frozen_context as FrozenContextV1;
    const input = {
      idempotency_key: 'generate-one-proposal',
      message_selection: {
        kind: 'selected',
        message_ids: [discussion.messages[1].id],
      },
      frozen_context_item_ids: [frozenContext.items[0].id],
    };
    const route = `/projects/${project.id}/discussions/${discussion.id}/knowledge-extractions`;
    const generatedResponse = await request(app!.getHttpServer())
      .post(route)
      .send(input)
      .expect(201);
    const generated =
      generatedResponse.body as KnowledgeExtractionProposalResponse;

    expect(generated).toMatchObject({
      project_id: project.id,
      discussion_id: discussion.id,
      status: 'ready',
      proposal: {
        title: 'Deterministic knowledge proposal',
        summary: 'A grounded proposal synthesized from the selected sources.',
      },
      source: {
        message_selection_kind: 'selected',
        message_ids: [discussion.messages[1].id],
        frozen_context_item_ids: [frozenContext.items[0].id],
      },
    });
    expect(Object.keys(generated.proposal)).toEqual([
      'title',
      'summary',
      'content',
    ]);

    await request(app!.getHttpServer())
      .post(route)
      .send(input)
      .expect(201)
      .expect(generated);
    await request(app!.getHttpServer())
      .post(route)
      .send({
        ...input,
        message_selection: {
          kind: 'selected',
          message_ids: [discussion.messages[0].id],
        },
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
        });
      });
    await request(app!.getHttpServer())
      .post(
        `/projects/${otherProject.id}/discussions/${discussion.id}/knowledge-extractions`,
      )
      .send({
        ...input,
        idempotency_key: 'cross-project-extraction',
      })
      .expect(404);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .post(route)
      .send(input)
      .expect(201)
      .expect(generated);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);
  });

  it('resolves as one persisted bubble, rejects, and discards through the nested commands', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Resolution owner',
        description: 'Only approved extraction becomes durable knowledge.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const anchorResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Existing cluster',
        content: 'Anchor extracted bubble placement.',
        position_x: 100,
        position_y: 200,
      })
      .expect(201);
    const anchor = anchorResponse.body as Bubble;
    const discussionResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'Which conclusion should become durable knowledge?',
        idempotency_key: 'create-resolution-source',
        bubble_ids: [],
        document_ids: [],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const frozenContext = discussion.frozen_context as FrozenContextV1;
    const route = `/projects/${project.id}/discussions/${discussion.id}/knowledge-extractions`;
    const discussionBeforeResponse = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200);
    const discussionBefore = discussionBeforeResponse.body as DiscussionDetails;
    const generatedResponse = await request(app!.getHttpServer())
      .post(route)
      .send({
        idempotency_key: 'resolve-new-bubble',
        message_selection: {
          kind: 'selected',
          message_ids: [discussion.messages[1].id],
        },
        frozen_context_item_ids: [frozenContext.items[0].id],
      })
      .expect(201);
    const generated =
      generatedResponse.body as KnowledgeExtractionProposalResponse;
    const resolutionInput = {
      kind: 'new_bubble',
      proposal: {
        title: 'Reviewed conclusion',
        summary: '',
        content: 'Persist only the reviewed, grounded conclusion.',
      },
    };
    const resolutionRoute = `${route}/${generated.id}/resolution`;
    const resolvedResponse = await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200);
    const resolved =
      resolvedResponse.body as KnowledgeExtractionResolutionResponse;

    expect(resolved).toMatchObject({
      id: generated.id,
      project_id: project.id,
      discussion_id: discussion.id,
      status: 'resolved',
      resolution: {
        kind: 'new_bubble',
        bubble: {
          title: 'Reviewed conclusion',
          summary: null,
          content: 'Persist only the reviewed, grounded conclusion.',
          position_x: 372,
          position_y: 200,
          source_kind: 'discussion',
          source_discussion_id: discussion.id,
          source_discussion_title: discussion.title,
          source_message_ids: [discussion.messages[1].id],
          source_context_item_ids: [frozenContext.items[0].id],
        },
      },
    });
    await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200)
      .expect(resolved);
    await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send({
        ...resolutionInput,
        proposal: {
          ...resolutionInput.proposal,
          content: 'Conflicting second resolution.',
        },
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'KNOWLEDGE_EXTRACTION_RESOLUTION_CONFLICT',
        });
      });

    const bubblesResponse = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles`)
      .expect(200);
    expect(bubblesResponse.body).toEqual([
      anchor,
      resolved.resolution.kind === 'new_bubble'
        ? resolved.resolution.bubble
        : undefined,
    ]);

    const rejectedProposalResponse = await request(app!.getHttpServer())
      .post(route)
      .send({
        idempotency_key: 'reject-resolution',
        message_selection: {
          kind: 'selected',
          message_ids: [discussion.messages[0].id],
        },
        frozen_context_item_ids: [],
      })
      .expect(201);
    const rejectedProposal =
      rejectedProposalResponse.body as KnowledgeExtractionProposalResponse;
    await request(app!.getHttpServer())
      .post(`${route}/${rejectedProposal.id}/resolution`)
      .send({ kind: 'reject' })
      .expect(200)
      .expect({
        id: rejectedProposal.id,
        project_id: project.id,
        discussion_id: discussion.id,
        status: 'resolved',
        resolution: { kind: 'reject' },
      });

    const discardedProposalResponse = await request(app!.getHttpServer())
      .post(route)
      .send({
        idempotency_key: 'discard-resolution',
        message_selection: {
          kind: 'selected',
          message_ids: [discussion.messages[1].id],
        },
        frozen_context_item_ids: [],
      })
      .expect(201);
    const discardedProposal =
      discardedProposalResponse.body as KnowledgeExtractionProposalResponse;
    await request(app!.getHttpServer())
      .delete(`${route}/${discardedProposal.id}`)
      .expect(204);
    await request(app!.getHttpServer())
      .delete(`${route}/${discardedProposal.id}`)
      .expect(204);
    await request(app!.getHttpServer())
      .post(`${route}/${discardedProposal.id}/resolution`)
      .send({ kind: 'reject' })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'KNOWLEDGE_EXTRACTION_DISCARDED',
        });
      });
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles`)
      .expect(200)
      .expect(bubblesResponse.body);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussionBefore);
  });
});
