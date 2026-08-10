import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  DiscussionDetails,
  FrozenContextV1,
  KnowledgeExtractionProposalResponse,
  Project,
} from '@nuee/shared-types';
import type { Bubble } from './../src/bubbles/bubble.types';
import {
  FAKE_STRUCTURED_PROPOSAL,
  FakeModelClient,
} from './../src/ai/fake-model.client';
import { MODEL_CLIENT, type ModelClient } from './../src/ai/model-client';
import { AppModule } from './../src/app.module';
import type { KnowledgeExtractionResolutionResponse } from './../src/knowledge-extraction/knowledge-extraction.types';

describe('Knowledge extraction generation journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-extraction-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'extractions.sqlite');
  const previousDatabasePath = process.env.PROJECT_DATABASE_PATH;
  let app: INestApplication<App> | undefined;

  async function startApplication(
    modelClient?: ModelClient,
  ): Promise<INestApplication<App>> {
    process.env.PROJECT_DATABASE_PATH = databasePath;
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    });

    if (modelClient) {
      moduleBuilder.overrideProvider(MODEL_CLIENT).useValue(modelClient);
    }

    const moduleFixture: TestingModule = await moduleBuilder.compile();
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

  it('generates an instructed detailed proposal, conflicts on changed intent, and replays it without changing the discussion', async () => {
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
      detail_level: 'detailed',
      message_ids: [discussion.messages[1].id],
      frozen_context_item_ids: [frozenContext.items[0].id],
      instructions: '  Focus on\n durable   knowledge.  ',
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
      .send({
        ...input,
        instructions: 'Focus on durable knowledge.',
      })
      .expect(201)
      .expect(generated);
    await request(app!.getHttpServer())
      .post(route)
      .send({
        ...input,
        instructions: 'Focus on operational risk.',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
        });
      });
    await request(app!.getHttpServer())
      .post(route)
      .send({
        ...input,
        detail_level: 'tight',
      })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'KNOWLEDGE_EXTRACTION_IDEMPOTENCY_CONFLICT',
        });
      });
    await request(app!.getHttpServer())
      .post(route)
      .send({
        ...input,
        message_ids: [discussion.messages[0].id],
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
      .send({
        ...input,
        instructions: 'Focus on durable knowledge.',
      })
      .expect(201)
      .expect(generated);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);
  });

  it('freezes explicit message sources before later messages and resolves only the captured provenance', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Whole discussion owner',
        description: 'Later turns must not rewrite an extraction snapshot.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const discussionResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'What knowledge is stable now?',
        idempotency_key: 'create-whole-discussion-source',
        bubble_ids: [],
        document_ids: [],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const initialMessageIds = discussion.messages.map(({ id }) => id);
    const route = `/projects/${project.id}/discussions/${discussion.id}/knowledge-extractions`;
    const input = {
      idempotency_key: 'explicit-message-snapshot',
      detail_level: 'standard',
      message_ids: initialMessageIds,
      frozen_context_item_ids: [],
    };
    const generatedResponse = await request(app!.getHttpServer())
      .post(route)
      .send(input)
      .expect(201);
    const generated =
      generatedResponse.body as KnowledgeExtractionProposalResponse;

    expect(generated.source).toEqual({
      message_ids: initialMessageIds,
      frozen_context_item_ids: [],
    });
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);

    const laterDiscussionResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions/${discussion.id}/messages`)
      .send({
        content: 'What changed after the snapshot?',
        idempotency_key: 'later-whole-discussion-turn',
      })
      .expect(200);
    const laterDiscussion = laterDiscussionResponse.body as DiscussionDetails;

    expect(laterDiscussion.messages).toHaveLength(4);
    expect(laterDiscussion.messages.map(({ id }) => id)).toEqual([
      ...initialMessageIds,
      expect.any(String),
      expect.any(String),
    ]);
    await request(app!.getHttpServer())
      .post(route)
      .send(input)
      .expect(201)
      .expect(generated);

    const resolutionInput = {
      kind: 'new_bubble',
      proposal: generated.proposal,
    };
    const resolutionRoute = `${route}/${generated.id}/resolution`;
    const resolvedResponse = await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200);
    const resolved =
      resolvedResponse.body as KnowledgeExtractionResolutionResponse;

    expect(resolved).toMatchObject({
      status: 'resolved',
      resolution: {
        kind: 'new_bubble',
        bubble: {
          project_id: project.id,
          source_discussion_id: discussion.id,
          source_message_ids: initialMessageIds,
        },
      },
    });
    await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200)
      .expect(resolved);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(laterDiscussion);
  });

  it('retries one failed model call with the same attempt and replays one persisted resolution', async () => {
    await app!.close();
    const deterministicModel = new FakeModelClient();
    const generateStructuredOutput = jest
      .fn<ModelClient['generateStructuredOutput']>()
      .mockRejectedValueOnce(new Error('Temporary model failure.'))
      .mockImplementation((input) =>
        deterministicModel.generateStructuredOutput(input),
      );
    const flakyModel: ModelClient = {
      generateAnswer: (input) => deterministicModel.generateAnswer(input),
      generateStructuredOutput,
      generateTitle: (input) => deterministicModel.generateTitle(input),
    };
    app = await startApplication(flakyModel);

    const projectResponse = await request(app.getHttpServer())
      .post('/projects')
      .send({
        title: 'Retry owner',
        description: 'Failures must leave the discussion unchanged.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const discussionResponse = await request(app.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'What survives a model retry?',
        idempotency_key: 'create-retry-source',
        bubble_ids: [],
        document_ids: [],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const route = `/projects/${project.id}/discussions/${discussion.id}/knowledge-extractions`;
    const input = {
      idempotency_key: 'retry-generation-attempt',
      detail_level: 'standard',
      message_ids: [discussion.messages[1].id],
      frozen_context_item_ids: [],
    };

    await request(app.getHttpServer())
      .post(route)
      .send(input)
      .expect(503)
      .expect({
        code: 'KNOWLEDGE_EXTRACTION_GENERATION_FAILED',
        message:
          'The knowledge proposal could not be generated. Retry with the same idempotency key.',
      });
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/bubbles`)
      .expect(200)
      .expect([]);

    const retryResponse = await request(app.getHttpServer())
      .post(route)
      .send(input)
      .expect(201);
    const generated = retryResponse.body as KnowledgeExtractionProposalResponse;

    expect(generated.proposal).toEqual(FAKE_STRUCTURED_PROPOSAL);
    await request(app.getHttpServer())
      .post(route)
      .send(input)
      .expect(201)
      .expect(generated);
    expect(generateStructuredOutput).toHaveBeenCalledTimes(2);

    const resolutionInput = {
      kind: 'new_bubble',
      proposal: generated.proposal,
    };
    const resolutionRoute = `${route}/${generated.id}/resolution`;
    const resolutionResponse = await request(app.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200);
    const resolved =
      resolutionResponse.body as KnowledgeExtractionResolutionResponse;

    await request(app.getHttpServer())
      .post(resolutionRoute)
      .send(resolutionInput)
      .expect(200)
      .expect(resolved);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/bubbles`)
      .expect(200)
      .expect(({ body }) => {
        const bubbles = body as Bubble[];

        expect(bubbles).toHaveLength(1);
        expect(bubbles[0]).toMatchObject({
          source_discussion_id: discussion.id,
          source_message_ids: [discussion.messages[1].id],
        });
      });
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
        detail_level: 'standard',
        message_ids: [discussion.messages[1].id],
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
        detail_level: 'standard',
        message_ids: [discussion.messages[0].id],
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
        detail_level: 'standard',
        message_ids: [discussion.messages[1].id],
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

    if (resolved.resolution.kind !== 'new_bubble') {
      throw new Error('Expected a new-bubble resolution.');
    }

    const extractedBubbleBeforeDeletion = resolved.resolution.bubble;
    await request(app!.getHttpServer())
      .delete(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(204);
    await request(app!.getHttpServer())
      .get(
        `/projects/${project.id}/bubbles/${extractedBubbleBeforeDeletion.id}`,
      )
      .expect(200)
      .expect(({ body }) => {
        const deletedSourceBubble = body as Bubble;
        const { source_discussion_deleted_at: deletedAt, ...retainedBubble } =
          deletedSourceBubble;
        const {
          source_discussion_deleted_at: previousDeletedAt,
          ...bubbleBeforeDeletion
        } = extractedBubbleBeforeDeletion;

        expect(previousDeletedAt).toBeNull();
        expect(deletedAt).not.toBeNull();
        expect(new Date(deletedAt!).toISOString()).toBe(deletedAt);
        expect(retainedBubble).toEqual(bubbleBeforeDeletion);
        expect(deletedSourceBubble).not.toHaveProperty('source_transcript');
      });
  });

  it('updates one current-project bubble only after confirming its latest observed version', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Update resolution owner',
        description: 'Extraction updates must not silently overwrite changes.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const targetResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Original target',
        summary: 'Original summary.',
        content: 'Original target content.',
        position_x: 480,
        position_y: -160,
      })
      .expect(201);
    const target = targetResponse.body as Bubble;
    const neighborResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Linked neighbor',
        content: 'The manual link must survive.',
        position_x: 720,
        position_y: -160,
      })
      .expect(201);
    const neighbor = neighborResponse.body as Bubble;
    const linkResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubble-links`)
      .send({
        bubble_a_id: target.id,
        bubble_b_id: neighbor.id,
      })
      .expect(201);
    const discussionResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        first_prompt: 'How should this bubble be replaced?',
        idempotency_key: 'create-update-resolution-source',
        bubble_ids: [target.id],
        document_ids: [],
      })
      .expect(201);
    const discussion = discussionResponse.body as DiscussionDetails;
    const frozenContext = discussion.frozen_context as FrozenContextV1;
    const frozenTarget = frozenContext.items.find(
      (item) => item.source_kind === 'bubble' && item.source_id === target.id,
    );

    expect(frozenTarget).toMatchObject({
      source_title: target.title,
      frozen_content: target.content,
    });

    const extractionRoute = `/projects/${project.id}/discussions/${discussion.id}/knowledge-extractions`;
    const generatedResponse = await request(app!.getHttpServer())
      .post(extractionRoute)
      .send({
        idempotency_key: 'resolve-existing-bubble',
        detail_level: 'standard',
        message_ids: [discussion.messages[1].id],
        frozen_context_item_ids: [frozenTarget!.id],
      })
      .expect(201);
    const generated =
      generatedResponse.body as KnowledgeExtractionProposalResponse;
    const concurrentResponse = await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/bubbles/${target.id}`)
      .send({
        title: 'Concurrent target edit',
        summary: 'This version must be reviewed.',
        content: 'Another client changed the target after selection.',
      })
      .expect(200);
    const concurrentTarget = concurrentResponse.body as Bubble;
    const proposal = {
      title: 'Reviewed extracted replacement',
      summary: 'The final knowledge after explicit conflict review.',
      content: 'Replace the target with this reviewed extraction proposal.',
    };
    const staleResolutionInput = {
      kind: 'update_bubble',
      proposal,
      target_bubble_id: target.id,
      expected_updated_at: target.updated_at,
    };
    const resolutionRoute = `${extractionRoute}/${generated.id}/resolution`;

    await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(staleResolutionInput)
      .expect(409)
      .expect({
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
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles/${target.id}`)
      .expect(200)
      .expect(concurrentTarget);

    const confirmedResolutionInput = {
      ...staleResolutionInput,
      expected_updated_at: concurrentTarget.updated_at,
    };
    const resolvedResponse = await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(confirmedResolutionInput)
      .expect(200);
    const resolved =
      resolvedResponse.body as KnowledgeExtractionResolutionResponse;

    expect(resolved).toMatchObject({
      id: generated.id,
      project_id: project.id,
      discussion_id: discussion.id,
      status: 'resolved',
      resolution: {
        kind: 'update_bubble',
        bubble: {
          id: target.id,
          project_id: project.id,
          title: proposal.title,
          summary: proposal.summary,
          content: proposal.content,
          position_x: target.position_x,
          position_y: target.position_y,
          created_at: target.created_at,
          source_kind: 'discussion',
          source_discussion_id: discussion.id,
          source_discussion_title: discussion.title,
          source_message_ids: [discussion.messages[1].id],
          source_context_item_ids: [frozenTarget!.id],
        },
      },
    });

    if (resolved.resolution.kind !== 'update_bubble') {
      throw new Error('Expected a bubble-update resolution.');
    }

    expect(Date.parse(resolved.resolution.bubble.updated_at)).toBeGreaterThan(
      Date.parse(concurrentTarget.updated_at),
    );
    await request(app!.getHttpServer())
      .post(resolutionRoute)
      .send(confirmedResolutionInput)
      .expect(200)
      .expect(resolved);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubble-links`)
      .expect(200)
      .expect([linkResponse.body]);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(200)
      .expect(discussion);

    const updatedBubbleBeforeDeletion = resolved.resolution.bubble;
    await request(app!.getHttpServer())
      .delete(`/projects/${project.id}/discussions/${discussion.id}`)
      .expect(204);
    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles/${updatedBubbleBeforeDeletion.id}`)
      .expect(200)
      .expect(({ body }) => {
        const deletedSourceBubble = body as Bubble;
        const { source_discussion_deleted_at: deletedAt, ...retainedBubble } =
          deletedSourceBubble;
        const {
          source_discussion_deleted_at: previousDeletedAt,
          ...bubbleBeforeDeletion
        } = updatedBubbleBeforeDeletion;

        expect(previousDeletedAt).toBeNull();
        expect(deletedAt).not.toBeNull();
        expect(new Date(deletedAt!).toISOString()).toBe(deletedAt);
        expect(retainedBubble).toEqual(bubbleBeforeDeletion);
      });
  });
});
