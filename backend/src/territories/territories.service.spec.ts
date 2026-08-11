import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { DatabaseTransaction } from '../database/database-transaction';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from './sqlite-territory.repository';
import { TerritoriesService } from './territories.service';
import { TerritoryDeletionService } from './territory-deletion.service';

describe('TerritoriesService', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteTerritoryRepository;
  let territories: TerritoriesService;
  let bubbles: BubblesService;
  let territoryDeletion: TerritoryDeletionService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T09:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteTerritoryRepository(databaseProvider);
    territories = new TerritoriesService(projects, repository);
    const transactions = new DatabaseTransaction(databaseProvider);
    bubbles = new BubblesService(
      projects,
      new SqliteBubbleRepository(databaseProvider),
      territories,
      transactions,
    );
    territoryDeletion = new TerritoryDeletionService(
      territories,
      repository,
      bubbles,
      transactions,
    );
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  function createProject(title = 'Territory project') {
    return projects.create({ title, description: `${title} description` });
  }

  it('creates one ungrouped territory on first bubble creation and reuses it', () => {
    const project = createProject();

    expect(territories.list(project.id)).toEqual([]);

    const first = bubbles.create(project.id, {
      title: 'First bubble',
      content: 'First content',
    });
    const second = bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Second content',
    });
    const listed = territories.list(project.id);

    expect(listed).toEqual([
      {
        id: first.territory_id,
        project_id: project.id,
        kind: 'ungrouped',
        title: 'Ungrouped',
        position_x: 0,
        position_y: 0,
        visible_count: 1,
        created_at: '2026-08-10T09:00:00.000Z',
        updated_at: '2026-08-10T09:00:00.000Z',
      },
    ]);
    expect(second.territory_id).toBe(first.territory_id);
  });

  it('clamps visible count to the territory total and persists positions', () => {
    const project = createProject();
    const first = bubbles.create(project.id, {
      title: 'First bubble',
      content: 'First content',
    });
    bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Second content',
    });

    jest.setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
    expect(
      territories.updateVisibleCount(project.id, first.territory_id, {
        visible_count: 999,
      }),
    ).toMatchObject({ visible_count: 2 });
    expect(
      territories.updateVisibleCount(project.id, first.territory_id, {
        visible_count: -3,
      }),
    ).toMatchObject({ visible_count: 1 });
    expect(
      territories.reposition(project.id, first.territory_id, {
        position_x: -120.5,
        position_y: 240,
      }),
    ).toMatchObject({ position_x: -120.5, position_y: 240 });
    expect(
      territories.repositionMany(project.id, {
        positions: [
          {
            territory_id: first.territory_id,
            position_x: 80,
            position_y: -40,
          },
        ],
      }),
    ).toEqual([expect.objectContaining({ position_x: 80, position_y: -40 })]);
  });

  it('rejects invalid territory mutations with stable project scoping', () => {
    const owner = createProject('Owner');
    const other = createProject('Other');
    const bubble = bubbles.create(owner.id, {
      title: 'Owned bubble',
      content: 'Owner content',
    });
    const otherBubble = bubbles.create(other.id, {
      title: 'Other bubble',
      content: 'Other content',
    });

    expect(() =>
      territories.reposition(owner.id, bubble.territory_id, {
        position_x: Number.NaN,
        position_y: 0,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      territories.updateVisibleCount(owner.id, bubble.territory_id, {
        visible_count: 1.5,
      }),
    ).toThrow(BadRequestException);
    expect(() => territories.list('missing-project')).toThrow(
      NotFoundException,
    );
    expect(() =>
      territories.reposition(other.id, bubble.territory_id, {
        position_x: 1,
        position_y: 2,
      }),
    ).toThrow(NotFoundException);
    expect(() =>
      bubbles.assignTerritories(owner.id, [
        {
          bubble_id: bubble.id,
          territory_id: otherBubble.territory_id,
        },
      ]),
    ).toThrow();
    expect(bubbles.get(owner.id, bubble.id).territory_id).toBe(
      bubble.territory_id,
    );
  });

  it('creates and renames a manual territory with normalized validated input', () => {
    const project = createProject();
    const created = territories.create(project.id, {
      title: '  Decisions  ',
      position_x: -20.5,
      position_y: 48,
    });

    expect(typeof created.id).toBe('string');
    expect(created).toEqual({
      id: created.id,
      project_id: project.id,
      kind: 'manual',
      title: 'Decisions',
      position_x: -20.5,
      position_y: 48,
      visible_count: 4,
      created_at: '2026-08-10T09:00:00.000Z',
      updated_at: '2026-08-10T09:00:00.000Z',
    });

    jest.setSystemTime(new Date('2026-08-10T10:00:00.000Z'));
    expect(
      territories.rename(project.id, created.id, { title: '  Evidence  ' }),
    ).toEqual(
      expect.objectContaining({
        kind: 'manual',
        title: 'Evidence',
        updated_at: '2026-08-10T10:00:00.000Z',
      }),
    );

    expect(() =>
      territories.create(project.id, {
        title: ' ',
        position_x: 0,
        position_y: 0,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      territories.rename(project.id, created.id, { title: 'x'.repeat(61) }),
    ).toThrow(BadRequestException);
  });

  it('clamps after bubble deletion and keeps an empty manual territory', () => {
    const project = createProject();
    const first = bubbles.create(project.id, {
      title: 'First bubble',
      content: 'First content',
    });
    const second = bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Second content',
    });
    const timestamp = '2026-08-10T09:30:00.000Z';
    const manual = territories.create(project.id, {
      title: 'Decisions',
      position_x: 300,
      position_y: 100,
    });
    repository.updateVisibleCount(project.id, manual.id, 2, timestamp);

    bubbles.assignTerritories(project.id, [
      { bubble_id: first.id, territory_id: manual.id },
      { bubble_id: second.id, territory_id: manual.id },
    ]);
    bubbles.delete(project.id, first.id);

    expect(territories.list(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manual.id,
          visible_count: 1,
        }),
      ]),
    );

    bubbles.delete(project.id, second.id);

    expect(territories.list(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: manual.id,
          kind: 'manual',
          visible_count: 1,
        }),
      ]),
    );
  });

  it('transactionally deletes a manual territory and moves its bubbles to Ungrouped', () => {
    const project = createProject();
    const manual = territories.create(project.id, {
      title: 'Decisions',
      position_x: 300,
      position_y: 100,
    });
    const first = bubbles.create(project.id, {
      title: 'First bubble',
      content: 'First content',
    });
    const second = bubbles.create(project.id, {
      title: 'Second bubble',
      content: 'Second content',
    });
    const ungroupedId = first.territory_id;
    bubbles.assignTerritories(project.id, [
      { bubble_id: first.id, territory_id: manual.id },
      { bubble_id: second.id, territory_id: manual.id },
    ]);

    expect(territoryDeletion.delete(project.id, manual.id)).toEqual({
      moved_bubble_count: 2,
    });
    expect(territories.list(project.id).map(({ id }) => id)).not.toContain(
      manual.id,
    );
    expect(bubbles.list(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, territory_id: ungroupedId }),
        expect.objectContaining({ id: second.id, territory_id: ungroupedId }),
      ]),
    );
  });

  it('rolls back bubble reassignment when territory deletion fails', () => {
    const project = createProject();
    const manual = territories.create(project.id, {
      title: 'Decisions',
      position_x: 300,
      position_y: 100,
    });
    const bubble = bubbles.create(project.id, {
      title: 'Preserved bubble',
      content: 'The failed deletion must leave membership unchanged.',
    });
    bubbles.assignTerritories(project.id, [
      { bubble_id: bubble.id, territory_id: manual.id },
    ]);
    jest.spyOn(repository, 'delete').mockReturnValueOnce(false);

    expect(() => territoryDeletion.delete(project.id, manual.id)).toThrow(
      'was unavailable during deletion',
    );
    expect(territories.list(project.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: manual.id })]),
    );
    expect(bubbles.get(project.id, bubble.id).territory_id).toBe(manual.id);
  });

  it('rejects rename and delete for Ungrouped with a stable error', () => {
    const project = createProject();
    const bubble = bubbles.create(project.id, {
      title: 'Ungrouped bubble',
      content: 'Ungrouped content',
    });

    for (const operation of [
      () =>
        territories.rename(project.id, bubble.territory_id, {
          title: 'Not allowed',
        }),
      () => territoryDeletion.delete(project.id, bubble.territory_id),
    ]) {
      try {
        operation();
        throw new Error('Expected immutable Ungrouped error.');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'TERRITORY_UNGROUPED_IMMUTABLE',
          message: 'Ungrouped cannot be renamed or deleted.',
        });
      }
    }
  });

  it('deletes an empty manual territory without creating Ungrouped', () => {
    const project = createProject();
    const timestamp = '2026-08-10T09:00:00.000Z';
    const manual = repository.create({
      id: 'manual-territory',
      project_id: project.id,
      kind: 'manual',
      title: 'Decisions',
      position_x: 300,
      position_y: 100,
      visible_count: 2,
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(territoryDeletion.delete(project.id, manual.id)).toEqual({
      moved_bubble_count: 0,
    });
    expect(territories.list(project.id)).toEqual([]);
  });
});
