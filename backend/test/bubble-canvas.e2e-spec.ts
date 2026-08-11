import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import request from 'supertest';
import { App } from 'supertest/types';
import type { Bubble, Project } from '@nuee/shared-types';
import { AppModule } from './../src/app.module';
import {
  MODEL_CLIENT,
  ModelGenerationError,
  type ModelClient,
} from './../src/ai/model-client';
import {
  DATABASE_MIGRATIONS,
  runDatabaseMigrations,
} from './../src/database/database.migrations';
import type {
  RecomposeTerritoriesResponse,
  Territory,
} from './../src/territories/territory.types';

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

    runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 14));
    database
      .prepare(
        `
          INSERT INTO projects (
            id, title, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        'prd-10-project',
        'PRD 10 territory map',
        'Existing composed territories migrate into user-owned territories.',
        '2026-08-09T11:00:00.000Z',
        '2026-08-09T11:00:00.000Z',
      );
    const insertPrd10Territory = database.prepare(
      `
        INSERT INTO territories (
          id, project_id, kind, title, position_x, position_y,
          visible_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    insertPrd10Territory.run(
      'prd-10-populated',
      'prd-10-project',
      'composed',
      'Existing research',
      -180,
      75,
      3,
      '2026-08-09T11:10:00.000Z',
      '2026-08-09T11:20:00.000Z',
    );
    insertPrd10Territory.run(
      'prd-10-empty',
      'prd-10-project',
      'composed',
      'Existing decisions',
      260,
      -35,
      4,
      '2026-08-09T11:15:00.000Z',
      '2026-08-09T11:15:00.000Z',
    );
    database
      .prepare(
        `
          INSERT INTO bubbles (
            id, project_id, territory_id, title, summary, content,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'prd-10-member',
        'prd-10-project',
        'prd-10-populated',
        'Preserved member',
        'Its complete record survives territory deletion.',
        'Keep content, links, and provenance untouched.',
        '2026-08-09T11:20:00.000Z',
        '2026-08-09T11:20:00.000Z',
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

  it('migrates, creates, renames, and transactionally deletes manual territories', async () => {
    const migratedResponse = await request(app!.getHttpServer())
      .get('/projects/prd-10-project/territories')
      .expect(200);
    expect(migratedResponse.body).toEqual([
      expect.objectContaining({
        id: 'prd-10-populated',
        kind: 'manual',
        title: 'Existing research',
        position_x: -180,
        position_y: 75,
        visible_count: 3,
      }),
      expect.objectContaining({
        id: 'prd-10-empty',
        kind: 'manual',
        title: 'Existing decisions',
        position_x: 260,
        position_y: -35,
        visible_count: 4,
      }),
    ]);

    const createdResponse = await request(app!.getHttpServer())
      .post('/projects/prd-10-project/territories')
      .send({
        title: '  New evidence  ',
        position_x: 420,
        position_y: 180,
      })
      .expect(201);
    const created = createdResponse.body as Territory;
    expect(created).toEqual(
      expect.objectContaining({
        kind: 'manual',
        title: 'New evidence',
        position_x: 420,
        position_y: 180,
        visible_count: 4,
      }),
    );

    const renamedResponse = await request(app!.getHttpServer())
      .patch(`/projects/prd-10-project/territories/${created.id}`)
      .send({ title: '  Renamed evidence  ' })
      .expect(200);
    expect(renamedResponse.body).toEqual(
      expect.objectContaining({
        id: created.id,
        kind: 'manual',
        title: 'Renamed evidence',
      }),
    );
    await request(app!.getHttpServer())
      .delete(`/projects/prd-10-project/territories/${created.id}`)
      .expect(200)
      .expect({ moved_bubble_count: 0 });

    const migratedRenameResponse = await request(app!.getHttpServer())
      .patch('/projects/prd-10-project/territories/prd-10-populated')
      .send({ title: 'Owned research' })
      .expect(200);
    expect(migratedRenameResponse.body).toEqual(
      expect.objectContaining({ title: 'Owned research' }),
    );
    await request(app!.getHttpServer())
      .delete('/projects/prd-10-project/territories/prd-10-populated')
      .expect(200)
      .expect({ moved_bubble_count: 1 });

    const territoriesAfterDelete = await request(app!.getHttpServer())
      .get('/projects/prd-10-project/territories')
      .expect(200);
    const ungrouped = (territoriesAfterDelete.body as Territory[]).find(
      ({ kind }) => kind === 'ungrouped',
    );
    expect(territoriesAfterDelete.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prd-10-empty', kind: 'manual' }),
        expect.objectContaining({ kind: 'ungrouped', title: 'Ungrouped' }),
      ]),
    );
    expect(territoriesAfterDelete.body).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'prd-10-populated' }),
      ]),
    );

    const bubblesAfterDelete = await request(app!.getHttpServer())
      .get('/projects/prd-10-project/bubbles')
      .expect(200);
    expect(bubblesAfterDelete.body).toEqual([
      expect.objectContaining({
        id: 'prd-10-member',
        territory_id: ungrouped?.id,
        title: 'Preserved member',
        summary: 'Its complete record survives territory deletion.',
        content: 'Keep content, links, and provenance untouched.',
      }),
    ]);

    const renameUngroupedResponse = await request(app!.getHttpServer())
      .patch(`/projects/prd-10-project/territories/${ungrouped?.id}`)
      .send({ title: 'Forbidden rename' })
      .expect(400);
    expect(renameUngroupedResponse.body).toEqual(
      expect.objectContaining({ code: 'TERRITORY_UNGROUPED_IMMUTABLE' }),
    );
    const deleteUngroupedResponse = await request(app!.getHttpServer())
      .delete(`/projects/prd-10-project/territories/${ungrouped?.id}`)
      .expect(400);
    expect(deleteUngroupedResponse.body).toEqual(
      expect.objectContaining({ code: 'TERRITORY_UNGROUPED_IMMUTABLE' }),
    );
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

  it('recomposes all bubbles and preserves the prior composition on retryable failures', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Recomposition journey',
        description: 'Exercise structured territory output.',
      })
      .expect(201);
    const project = projectResponse.body as Project;
    const firstResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Market entry',
        summary: 'The first segment is large enough.',
        content: 'Start with the highest-intent segment.',
      })
      .expect(201);
    const secondResponse = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/bubbles`)
      .send({
        title: 'Launch operations',
        summary: 'Licensing is the critical path.',
        content: 'Begin licensing work before launch production.',
      })
      .expect(201);
    const first = firstResponse.body as Bubble;
    const second = secondResponse.body as Bubble;

    const invalidInput = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/territories/recompose`)
      .send({ instructions: 'Ignore the fixed workflow.' })
      .expect(400);
    expect(invalidInput.body).toEqual(
      expect.objectContaining({
        code: 'TERRITORY_RECOMPOSE_INPUT_INVALID',
      }),
    );

    const success = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/territories/recompose`)
      .send({})
      .expect(201);
    const recomposition =
      success.body as unknown as RecomposeTerritoriesResponse;
    const territories = recomposition.territories;
    const recomposedBubbles = recomposition.bubbles;
    const composed = territories.filter(({ kind }) => kind === 'manual');

    expect(composed).toHaveLength(1);
    expect(territories).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ungrouped' })]),
    );
    expect(recomposedBubbles.map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(
      new Set(recomposedBubbles.map(({ territory_id }) => territory_id)),
    ).toEqual(new Set([composed[0].id]));

    const modelClient = app!.get<ModelClient>(MODEL_CLIENT);
    const generate = jest.spyOn(modelClient, 'generateStructuredOutput');
    const snapshot = JSON.parse(JSON.stringify(success.body)) as {
      territories: Territory[];
      bubbles: Bubble[];
    };

    generate.mockResolvedValueOnce({
      output: {
        territories: [{ title: 'Incomplete', bubble_ids: [first.id] }],
      },
      model: 'invalid-controlled-model',
    });
    const invalidOutput = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/territories/recompose`)
      .send({})
      .expect(503);
    expect(invalidOutput.body).toEqual(
      expect.objectContaining({
        code: 'TERRITORY_RECOMPOSE_FAILED',
        reason: 'invalid_output',
      }),
    );

    generate.mockRejectedValueOnce(new ModelGenerationError('provider'));
    const providerFailure = await request(app!.getHttpServer())
      .post(`/projects/${project.id}/territories/recompose`)
      .send({})
      .expect(503);
    expect(providerFailure.body).toEqual(
      expect.objectContaining({
        code: 'TERRITORY_RECOMPOSE_FAILED',
        reason: 'provider',
      }),
    );

    const persistedTerritories = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/territories`)
      .expect(200);
    const persistedBubbles = await request(app!.getHttpServer())
      .get(`/projects/${project.id}/bubbles`)
      .expect(200);
    expect(persistedTerritories.body).toEqual(snapshot.territories);
    expect(persistedBubbles.body).toEqual(snapshot.bubbles);
  });
});
