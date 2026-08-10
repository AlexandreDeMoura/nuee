import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from '../territories/sqlite-territory.repository';
import { TerritoriesService } from '../territories/territories.service';
import { BubblesController } from './bubbles.controller';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblesController', () => {
  let temporaryDirectory: string;
  let databaseProvider: DatabaseProvider;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let controller: BubblesController;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubble-api-'));
    const databasePath = join(temporaryDirectory, 'bubbles.sqlite');
    databaseProvider = new DatabaseProvider({ databasePath });
    projectRepository = new SqliteProjectRepository(databaseProvider);
    bubbleRepository = new SqliteBubbleRepository(databaseProvider);
    projects = new ProjectsService(projectRepository);
    controller = new BubblesController(
      new BubblesService(
        projects,
        bubbleRepository,
        new TerritoriesService(
          projects,
          new SqliteTerritoryRepository(databaseProvider),
        ),
        new DatabaseTransaction(databaseProvider),
      ),
    );
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('supports project-scoped create, list, read, update, and delete operations', () => {
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
      territory_id: created.territory_id,
      source_kind: 'manual',
      source_discussion_id: null,
      source_discussion_title: null,
      source_discussion_deleted_at: null,
      source_message_ids: [],
      source_context_item_ids: [],
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
