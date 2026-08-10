import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Bubble, Project, Territory } from '@nuee/shared-types';
import { AppModule } from './../src/app.module';
import {
  DATABASE_MIGRATIONS,
  runDatabaseMigrations,
} from './../src/database/database.migrations';

describe('Territory canvas persistence journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-territory-canvas-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'territory-canvas.sqlite');
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

  beforeAll(() => {
    const database = new DatabaseSync(databasePath);
    database.exec('PRAGMA foreign_keys = ON;');
    runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 13));
    database
      .prepare(
        `
          INSERT INTO projects (
            id, title, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'legacy-project',
        'Legacy canvas',
        'A project created before territories existed.',
        '2026-08-09T08:00:00.000Z',
        '2026-08-09T08:00:00.000Z',
      );
    const insertBubble = database.prepare(
      `
        INSERT INTO bubbles (
          id, project_id, title, content, position_x, position_y,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertBubble.run(
      'legacy-bubble-a',
      'legacy-project',
      'Legacy left edge',
      'Must survive the territory migration.',
      -300,
      80,
      '2026-08-09T09:00:00.000Z',
      '2026-08-09T09:00:00.000Z',
    );
    insertBubble.run(
      'legacy-bubble-b',
      'legacy-project',
      'Legacy top edge',
      'Must share the migrated ungrouped territory.',
      40,
      -140,
      '2026-08-09T10:00:00.000Z',
      '2026-08-09T10:00:00.000Z',
    );
    database.close();
  });

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

  it('migrates legacy bubbles and persists territory mutations across reloads', async () => {
    const migratedTerritoriesResponse = await request(app!.getHttpServer())
      .get('/projects/legacy-project/territories')
      .expect(200);
    const migratedTerritories = migratedTerritoriesResponse.body as Territory[];

    expect(migratedTerritories).toEqual([
      expect.objectContaining({
        project_id: 'legacy-project',
        kind: 'ungrouped',
        title: 'Ungrouped',
        position_x: -300,
        position_y: -140,
        visible_count: 2,
      }),
    ]);

    const migratedBubblesResponse = await request(app!.getHttpServer())
      .get('/projects/legacy-project/bubbles')
      .expect(200);
    const migratedBubbles = migratedBubblesResponse.body as Bubble[];
    expect(migratedBubbles.map(({ territory_id }) => territory_id)).toEqual([
      migratedTerritories[0].id,
      migratedTerritories[0].id,
    ]);
    expect(migratedBubbles[0]).not.toHaveProperty('position_x');
    expect(migratedBubbles[0]).not.toHaveProperty('position_y');

    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Territory canvas journey',
        description: 'Exercise durable territory-backed knowledge.',
      })
      .expect(201);
    const project = projectResponse.body as Project;

    await request(app!.getHttpServer())
      .get(`/projects/${project.id}/territories`)
      .expect(200)
      .expect([]);

    const firstResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Existing launch constraint',
        summary: 'Licensing remains the longest lead-time item.',
        content: 'The current licensing estimate is nine to fourteen months.',
      })
      .expect(201);
    const secondResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Reusable market thesis',
        summary: 'A focused segment can support the initial launch.',
        content: 'Demand is fragmented, but the first segment is large enough.',
      })
      .expect(201);
    const first = firstResponse.body as Bubble;
    const second = secondResponse.body as Bubble;

    expect(second.territory_id).toBe(first.territory_id);
    expect(first).not.toHaveProperty('position_x');
    const territoryResponse = await request(app!.getHttpServer())
      .patch(
        `/projects/${project.id}/territories/${first.territory_id}/visible-count`,
      )
      .send({ visible_count: 99 })
      .expect(200);
    expect(territoryResponse.body).toEqual(
      expect.objectContaining({ visible_count: 2 }),
    );

    const movedTerritoryResponse = await request(app!.getHttpServer())
      .patch(
        `/projects/${project.id}/territories/${first.territory_id}/position`,
      )
      .send({ position_x: 580, position_y: 340 })
      .expect(200);
    expect(movedTerritoryResponse.body).toEqual(
      expect.objectContaining({ position_x: 580, position_y: 340 }),
    );

    const compactedTerritoriesResponse = await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/territories/positions`)
      .send({
        positions: [
          {
            territory_id: first.territory_id,
            position_x: -48,
            position_y: 120,
          },
        ],
      })
      .expect(200);
    expect(compactedTerritoriesResponse.body).toEqual([
      expect.objectContaining({ position_x: -48, position_y: 120 }),
    ]);

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubble-links`)
      .send({ bubble_a_id: first.id, bubble_b_id: second.id })
      .expect(201);

    await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles/placement`)
      .send({ strategy: 'cluster' })
      .expect(404);
    await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/bubbles/${second.id}/position`)
      .send({ position_x: 1, position_y: 2 })
      .expect(404);
    await request(app!.getHttpServer())
      .patch(`/projects/${project.id}/bubbles/positions`)
      .send({ positions: [] })
      .expect(404);

    await app!.close();
    app = await startApplication();

    const reloadedTerritoriesResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/territories`)
      .expect(200);
    expect(reloadedTerritoriesResponse.body).toEqual([
      expect.objectContaining({
        id: first.territory_id,
        position_x: -48,
        position_y: 120,
        visible_count: 2,
      }),
    ]);

    await request(app.getHttpServer())
      .delete(`/projects/${project.id}/bubbles/${second.id}`)
      .expect(204);
    const clampedTerritoriesResponse = await request(app.getHttpServer())
      .get(`/projects/${project.id}/territories`)
      .expect(200);
    expect(clampedTerritoriesResponse.body).toEqual([
      expect.objectContaining({
        id: first.territory_id,
        kind: 'ungrouped',
        visible_count: 1,
      }),
    ]);
    await request(app.getHttpServer())
      .get(`/projects/${project.id}/bubble-links`)
      .expect(200)
      .expect([]);
  });
});
