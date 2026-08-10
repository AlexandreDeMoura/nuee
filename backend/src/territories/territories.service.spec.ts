import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BubblesService } from '../bubbles/bubbles.service';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { DatabaseTransaction } from '../database/database-transaction';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { SqliteTerritoryRepository } from './sqlite-territory.repository';
import { TerritoriesService } from './territories.service';

describe('TerritoriesService', () => {
  let databaseProvider: DatabaseProvider;
  let projects: ProjectsService;
  let repository: SqliteTerritoryRepository;
  let territories: TerritoriesService;
  let bubbles: BubblesService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T09:00:00.000Z'));
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    projects = new ProjectsService(
      new SqliteProjectRepository(databaseProvider),
    );
    repository = new SqliteTerritoryRepository(databaseProvider);
    territories = new TerritoriesService(projects, repository);
    bubbles = new BubblesService(
      projects,
      new SqliteBubbleRepository(databaseProvider),
      territories,
      new DatabaseTransaction(databaseProvider),
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

  it('clamps after deletion and removes a composed territory with its last bubble', () => {
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
    const composed = repository.create({
      id: 'composed-territory',
      project_id: project.id,
      kind: 'composed',
      title: 'Decisions',
      position_x: 300,
      position_y: 100,
      visible_count: 2,
      created_at: timestamp,
      updated_at: timestamp,
    });

    bubbles.assignTerritories(project.id, [
      { bubble_id: first.id, territory_id: composed.id },
      { bubble_id: second.id, territory_id: composed.id },
    ]);
    bubbles.delete(project.id, first.id);

    expect(territories.list(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: composed.id,
          visible_count: 1,
        }),
      ]),
    );

    bubbles.delete(project.id, second.id);

    expect(territories.list(project.id).map(({ id }) => id)).not.toContain(
      composed.id,
    );
    expect(territories.list(project.id)).toEqual([
      expect.objectContaining({
        id: first.territory_id,
        kind: 'ungrouped',
      }),
    ]);
  });
});
