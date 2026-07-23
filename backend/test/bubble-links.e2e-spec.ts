import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Manual bubble links (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-bubble-links-e2e-'),
  );
  const databasePath = join(temporaryDirectory, 'bubble-links.sqlite');
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

  it('creates, reloads, de-duplicates, scopes, and symmetrically removes a link', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({ title: 'Linked knowledge', description: 'Test direct links.' })
      .expect(201);
    const projectId = (projectResponse.body as { id: string }).id;
    const otherProjectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({ title: 'Other project', description: 'Must remain isolated.' })
      .expect(201);

    const firstResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({ title: 'First', content: 'First knowledge bubble.' })
      .expect(201);
    const secondResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({ title: 'Second', content: 'Second knowledge bubble.' })
      .expect(201);
    const firstId = (firstResponse.body as { id: string }).id;
    const secondId = (secondResponse.body as { id: string }).id;

    const createdResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubble-links`)
      .send({ bubble_a_id: secondId, bubble_b_id: firstId })
      .expect(201);
    const createdLink = createdResponse.body as {
      id: string;
      project_id: string;
      bubble_a_id: string;
      bubble_b_id: string;
      created_at: string;
    };

    expect(createdLink.project_id).toBe(projectId);
    expect(createdLink.bubble_a_id < createdLink.bubble_b_id).toBe(true);

    await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubble-links`)
      .send({ bubble_a_id: firstId, bubble_b_id: secondId })
      .expect(201)
      .expect(createdLink);

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/bubble-links`)
      .expect(200)
      .expect([createdLink]);

    await request(app.getHttpServer())
      .post(
        `/projects/${(otherProjectResponse.body as { id: string }).id}/bubble-links`,
      )
      .send({ bubble_a_id: firstId, bubble_b_id: secondId })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/projects/${projectId}/bubble-links/${secondId}/${firstId}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/bubble-links`)
      .expect(200)
      .expect([]);
  });

  it('deletes a bubble and all of its links while retaining other bubbles after reload', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Deletion cleanup',
        description: 'Keep unrelated project knowledge intact.',
      })
      .expect(201);
    const projectId = (projectResponse.body as { id: string }).id;

    const deletedResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({ title: 'Delete me', content: 'Temporary knowledge.' })
      .expect(201);
    const firstRetainedResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({ title: 'Keep first', content: 'Durable knowledge.' })
      .expect(201);
    const secondRetainedResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({ title: 'Keep second', content: 'More durable knowledge.' })
      .expect(201);
    const deletedId = (deletedResponse.body as { id: string }).id;
    const firstRetainedId = (firstRetainedResponse.body as { id: string }).id;
    const secondRetainedId = (secondRetainedResponse.body as { id: string }).id;

    await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubble-links`)
      .send({ bubble_a_id: deletedId, bubble_b_id: firstRetainedId })
      .expect(201);
    await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubble-links`)
      .send({ bubble_a_id: secondRetainedId, bubble_b_id: deletedId })
      .expect(201);

    await request(app!.getHttpServer())
      .delete(`/projects/${projectId}/bubbles/${deletedId}`)
      .expect(204);

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${projectId}/bubble-links`)
      .expect(200)
      .expect([]);
    const retainedBubblesResponse = await request(app.getHttpServer())
      .get(`/projects/${projectId}/bubbles`)
      .expect(200);
    const retainedIds = (
      retainedBubblesResponse.body as Array<{ id: string }>
    ).map((bubble) => bubble.id);

    expect(retainedIds).toEqual([firstRetainedId, secondRetainedId]);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/projects/${projectId}/bubbles/${deletedId}`)
      .expect(404);
  });

  it('persists a position batch as one project-scoped operation without touching content timestamps', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Compact layout',
        description: 'Persist compact bubble positions together.',
      })
      .expect(201);
    const otherProjectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Other layout',
        description: 'Must remain isolated.',
      })
      .expect(201);
    const projectId = (projectResponse.body as { id: string }).id;
    const otherProjectId = (otherProjectResponse.body as { id: string }).id;

    const firstResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({
        title: 'First',
        content: 'First compacted bubble.',
        position_x: 10,
        position_y: 20,
      })
      .expect(201);
    const secondResponse = await request(app!.getHttpServer())
      .post(`/projects/${projectId}/bubbles`)
      .send({
        title: 'Second',
        content: 'Second compacted bubble.',
        position_x: 700,
        position_y: 500,
      })
      .expect(201);
    const otherResponse = await request(app!.getHttpServer())
      .post(`/projects/${otherProjectId}/bubbles`)
      .send({
        title: 'Other',
        content: 'A bubble in another project.',
      })
      .expect(201);
    const first = firstResponse.body as {
      id: string;
      updated_at: string;
    };
    const second = secondResponse.body as {
      id: string;
      updated_at: string;
    };
    const otherId = (otherResponse.body as { id: string }).id;

    const batch = [
      { bubble_id: first.id, position_x: 10, position_y: 20 },
      { bubble_id: second.id, position_x: 282, position_y: 20 },
    ];
    const response = await request(app!.getHttpServer())
      .patch(`/projects/${projectId}/bubbles/positions`)
      .send({ positions: batch })
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: first.id,
        position_x: 10,
        position_y: 20,
        updated_at: first.updated_at,
      }),
      expect.objectContaining({
        id: second.id,
        position_x: 282,
        position_y: 20,
        updated_at: second.updated_at,
      }),
    ]);

    await request(app!.getHttpServer())
      .patch(`/projects/${projectId}/bubbles/positions`)
      .send({
        positions: [
          { bubble_id: first.id, position_x: 999, position_y: 999 },
          { bubble_id: otherId, position_x: 500, position_y: 500 },
        ],
      })
      .expect(404);

    const retainedFirstResponse = await request(app!.getHttpServer())
      .get(`/projects/${projectId}/bubbles/${first.id}`)
      .expect(200);

    expect(retainedFirstResponse.body).toEqual(
      expect.objectContaining({
        position_x: 10,
        position_y: 20,
        updated_at: first.updated_at,
      }),
    );
  });
});
