import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Project creation journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-project-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'projects.sqlite');
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

  it('validates, creates, reopens, updates, and reloads a project', async () => {
    await request(app!.getHttpServer())
      .post('/projects')
      .send({ title: '   ', description: 'An initial description.' })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          code: 'PROJECT_VALIDATION_FAILED',
          field_errors: { title: 'Title is required.' },
        });
      });

    const createdResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: '  Launch plan  ',
        description: '  Explore the launch constraints.  ',
      })
      .expect(201);

    const createdProject = createdResponse.body as {
      id: string;
      title: string;
      description: string;
      created_at: string;
      updated_at: string;
      canvas_viewport_x: number;
      canvas_viewport_y: number;
      canvas_zoom: number;
    };

    expect(createdProject).toMatchObject({
      title: 'Launch plan',
      description: 'Explore the launch constraints.',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
    expect(createdProject.id).toEqual(expect.any(String));
    expect(createdProject.created_at).toEqual(expect.any(String));
    expect(createdProject.updated_at).toBe(createdProject.created_at);

    await request(app!.getHttpServer())
      .get(`/projects/${createdProject.id}`)
      .expect(200)
      .expect(createdProject);

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get('/projects')
      .expect(200)
      .expect([createdProject]);

    const updatedResponse = await request(app.getHttpServer())
      .patch(`/projects/${createdProject.id}/description`)
      .send({ description: '  Persisted across later sessions.  ' })
      .expect(200);

    const updatedProject = updatedResponse.body as typeof createdProject;
    expect(updatedProject).toMatchObject({
      id: createdProject.id,
      title: createdProject.title,
      description: 'Persisted across later sessions.',
      created_at: createdProject.created_at,
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
    expect(new Date(updatedProject.updated_at).getTime()).toBeGreaterThan(
      new Date(createdProject.updated_at).getTime(),
    );

    await app.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}`)
      .expect(200)
      .expect(updatedProject);
  });
});
