import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  DiscussionDetails,
  DiscussionListResponse,
  Project,
} from '@nuee/shared-types';
import { AppModule } from './../src/app.module';

describe('Discussion lifecycle journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-discussion-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'discussions.sqlite');
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
  ): Promise<DiscussionDetails> {
    const response = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        frozen_context: {
          project_description: {
            content: project.description,
            captured_at: project.updated_at,
          },
        },
        first_prompt: prompt,
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
    const first = await createDiscussion(project, 'What is the first risk?');

    expect(first).toMatchObject({
      project_id: project.id,
      title: 'New discussion',
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

  it('returns stable validation errors', async () => {
    const project = await createProject('Validation');

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/discussions`)
      .send({
        project_id: project.id,
        frozen_context: {},
        first_prompt: '   ',
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
        frozen_context: {},
        first_prompt: 'Valid question',
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
});
