import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface JourneyProject {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

interface JourneyBubble {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  content: string;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
  source_kind: 'manual' | 'discussion';
  source_discussion_id: string | null;
  source_message_ids: string[];
}

interface JourneyLink {
  id: string;
  project_id: string;
  bubble_a_id: string;
  bubble_b_id: string;
  created_at: string;
}

describe('Bubble canvas journey (e2e)', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-bubble-canvas-journey-'),
  );
  const databasePath = join(temporaryDirectory, 'bubble-canvas.sqlite');
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

  it('persists the create, move, edit, link, compact, reload, and delete journey', async () => {
    const projectResponse = await request(app!.getHttpServer())
      .post('/projects')
      .send({
        title: 'Bubble canvas journey',
        description: 'Exercise durable project knowledge from the canvas.',
      })
      .expect(201);
    const createdProject = projectResponse.body as JourneyProject;

    const viewportResponse = await request(app!.getHttpServer())
      .patch(`/projects/${createdProject.id}/viewport`)
      .send({
        canvas_viewport_x: -84,
        canvas_viewport_y: 46,
        canvas_zoom: 1.25,
      })
      .expect(200);
    const persistedProject = viewportResponse.body as JourneyProject;

    const anchorResponse = await request(app!.getHttpServer())
      .post(`/projects/${createdProject.id}/bubbles`)
      .send({
        title: 'Existing launch constraint',
        summary: 'Licensing remains the longest lead-time item.',
        content: 'The current licensing estimate is nine to fourteen months.',
        position_x: -320,
        position_y: 120,
      })
      .expect(201);
    const anchor = anchorResponse.body as JourneyBubble;

    const placementResponse = await request(app!.getHttpServer())
      .post(`/projects/${createdProject.id}/bubbles/placement`)
      .send({
        strategy: 'viewport',
        viewport_x: 0,
        viewport_y: 0,
        viewport_width: 1200,
        viewport_height: 800,
      })
      .expect(201);
    const placement = placementResponse.body as {
      position_x: number;
      position_y: number;
    };

    const createdBubbleResponse = await request(app!.getHttpServer())
      .post(`/projects/${createdProject.id}/bubbles`)
      .send({
        title: 'Reusable market thesis',
        summary: 'A focused segment can support the initial launch.',
        content: 'Demand is fragmented, but the first segment is large enough.',
        ...placement,
      })
      .expect(201);
    const createdBubble = createdBubbleResponse.body as JourneyBubble;

    const movedResponse = await request(app!.getHttpServer())
      .patch(
        `/projects/${createdProject.id}/bubbles/${createdBubble.id}/position`,
      )
      .send({ position_x: 580, position_y: 340 })
      .expect(200);
    const movedBubble = movedResponse.body as JourneyBubble;

    expect(movedBubble).toMatchObject({
      position_x: 580,
      position_y: 340,
      updated_at: createdBubble.updated_at,
    });

    const updatedResponse = await request(app!.getHttpServer())
      .patch(`/projects/${createdProject.id}/bubbles/${createdBubble.id}`)
      .send({
        title: 'Focused market thesis',
        summary: 'The first buyer segment supports a focused launch.',
        content:
          'Demand remains fragmented, but the first buyer segment is large enough for launch.',
      })
      .expect(200);
    const updatedBubble = updatedResponse.body as JourneyBubble;

    expect(updatedBubble).toMatchObject({
      position_x: 580,
      position_y: 340,
      title: 'Focused market thesis',
      summary: 'The first buyer segment supports a focused launch.',
    });
    expect(new Date(updatedBubble.updated_at).getTime()).toBeGreaterThan(
      new Date(createdBubble.updated_at).getTime(),
    );

    const linkResponse = await request(app!.getHttpServer())
      .post(`/projects/${createdProject.id}/bubble-links`)
      .send({
        bubble_a_id: updatedBubble.id,
        bubble_b_id: anchor.id,
      })
      .expect(201);
    const persistedLink = linkResponse.body as JourneyLink;
    const timestampsBeforeCompact = new Map([
      [anchor.id, anchor.updated_at],
      [updatedBubble.id, updatedBubble.updated_at],
    ]);
    const compactPositions = [
      {
        bubble_id: anchor.id,
        position_x: -320,
        position_y: 120,
      },
      {
        bubble_id: updatedBubble.id,
        position_x: -48,
        position_y: 120,
      },
    ];

    const compactResponse = await request(app!.getHttpServer())
      .patch(`/projects/${createdProject.id}/bubbles/positions`)
      .send({ positions: compactPositions })
      .expect(200);
    const compactedBubbles = compactResponse.body as JourneyBubble[];

    expect(compactedBubbles).toHaveLength(2);
    for (const compactedBubble of compactedBubbles) {
      expect(compactedBubble.updated_at).toBe(
        timestampsBeforeCompact.get(compactedBubble.id),
      );
    }

    await app!.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}`)
      .expect(200)
      .expect(persistedProject);

    const reloadedBubblesResponse = await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}/bubbles`)
      .expect(200);
    const reloadedBubbles = reloadedBubblesResponse.body as JourneyBubble[];

    expect(reloadedBubbles).toEqual([
      expect.objectContaining({
        id: anchor.id,
        title: anchor.title,
        content: anchor.content,
        position_x: -320,
        position_y: 120,
        updated_at: anchor.updated_at,
      }),
      expect.objectContaining({
        id: updatedBubble.id,
        title: 'Focused market thesis',
        summary: 'The first buyer segment supports a focused launch.',
        content:
          'Demand remains fragmented, but the first buyer segment is large enough for launch.',
        position_x: -48,
        position_y: 120,
        updated_at: updatedBubble.updated_at,
      }),
    ]);
    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}/bubble-links`)
      .expect(200)
      .expect([persistedLink]);

    await request(app.getHttpServer())
      .delete(`/projects/${createdProject.id}/bubbles/${updatedBubble.id}`)
      .expect(204);

    await app.close();
    app = await startApplication();

    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}/bubble-links`)
      .expect(200)
      .expect([]);
    const retainedBubblesResponse = await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}/bubbles`)
      .expect(200);
    expect(retainedBubblesResponse.body).toEqual([
      expect.objectContaining({ id: anchor.id }),
    ]);
    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}`)
      .expect(200)
      .expect(persistedProject);
    await request(app.getHttpServer())
      .get(`/projects/${createdProject.id}/bubbles/${updatedBubble.id}`)
      .expect(404);
  });
});
