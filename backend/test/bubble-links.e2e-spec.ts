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
});
