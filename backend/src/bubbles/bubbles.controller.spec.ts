import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { BubblePlacementService } from './bubble-placement.service';
import { BubblesController } from './bubbles.controller';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblesController', () => {
  let temporaryDirectory: string;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let controller: BubblesController;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubble-api-'));
    const databasePath = join(temporaryDirectory, 'bubbles.sqlite');
    projectRepository = new SqliteProjectRepository(databasePath);
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    projects = new ProjectsService(projectRepository);
    controller = new BubblesController(
      new BubblesService(projects, bubbleRepository),
      new BubblePlacementService(projects, bubbleRepository),
    );
  });

  afterEach(() => {
    bubbleRepository.onModuleDestroy();
    projectRepository.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('supports project-scoped create, list, read, update, reposition, and delete operations', () => {
    const project = projects.create({
      title: 'Bubble API',
      description: 'Exercise every operation.',
    });
    const created = controller.create(project.id, {
      title: '  API bubble  ',
      content: '  Initial content  ',
    });

    expect(created).toMatchObject({
      project_id: project.id,
      title: 'API bubble',
      summary: null,
      content: 'Initial content',
      position_x: 0,
      position_y: 0,
      source_kind: 'manual',
      source_discussion_id: null,
      source_message_ids: [],
    });
    expect(controller.list(project.id)).toEqual([created]);
    expect(controller.get(project.id, created.id)).toEqual(created);

    const updated = controller.update(project.id, created.id, {
      summary: 'Added later',
      content: 'Revised content',
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: created.title,
      summary: 'Added later',
      content: 'Revised content',
    });

    const repositioned = controller.reposition(project.id, created.id, {
      position_x: 42,
      position_y: -24,
    });
    expect(repositioned).toEqual({
      ...updated,
      position_x: 42,
      position_y: -24,
    });
    expect(repositioned.updated_at).toBe(updated.updated_at);

    const batchRepositioned = controller.repositionMany(project.id, {
      positions: [
        {
          bubble_id: created.id,
          position_x: -120,
          position_y: 240,
        },
      ],
    });
    expect(batchRepositioned).toEqual([
      {
        ...repositioned,
        position_x: -120,
        position_y: 240,
      },
    ]);
    expect(batchRepositioned[0].updated_at).toBe(updated.updated_at);

    expect(controller.delete(project.id, created.id)).toBeUndefined();
    expect(controller.list(project.id)).toEqual([]);
  });

  it('does not expose a bubble through a different project route', () => {
    const owner = projects.create({
      title: 'Owner',
      description: 'Owns the bubble.',
    });
    const other = projects.create({
      title: 'Other',
      description: 'Must not see the bubble.',
    });
    const bubble = controller.create(owner.id, {
      title: 'Scoped bubble',
      content: 'Only visible to its owning project.',
    });

    expect(() => controller.get(other.id, bubble.id)).toThrow(
      NotFoundException,
    );
    expect(controller.list(other.id)).toEqual([]);
  });

  it('exposes project-scoped viewport and cluster placement operations', () => {
    const project = projects.create({
      title: 'Placement API',
      description: 'Place bubbles without duplicating canvas geometry.',
    });

    expect(
      controller.place(project.id, {
        strategy: 'viewport',
        viewport_x: 0,
        viewport_y: 0,
        viewport_width: 1000,
        viewport_height: 800,
      }),
    ).toEqual({ position_x: 376, position_y: 323 });

    const bubble = controller.create(project.id, {
      title: 'Centered',
      content: 'Already occupies the center.',
      position_x: 376,
      position_y: 323,
    });

    expect(controller.place(project.id, { strategy: 'cluster' })).toEqual({
      position_x: bubble.position_x + 272,
      position_y: bubble.position_y,
    });
  });

  it('returns a stable validation error', () => {
    const project = projects.create({
      title: 'Validation',
      description: 'Valid project.',
    });

    expect.assertions(2);

    try {
      controller.create(project.id, { title: ' ', content: 'Content' });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { title: 'Title is required.' },
      });
    }
  });

  it('returns a stable not-found error for a missing bubble identifier', () => {
    const project = projects.create({
      title: 'Missing bubble',
      description: 'Valid project.',
    });

    expect.assertions(2);

    try {
      controller.get(project.id, 'missing-bubble');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'BUBBLE_NOT_FOUND',
        message: `Bubble "missing-bubble" was not found in project "${project.id}".`,
      });
    }
  });
});
