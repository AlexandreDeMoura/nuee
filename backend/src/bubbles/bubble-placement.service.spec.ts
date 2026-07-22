import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import {
  BUBBLE_CARD_HEIGHT,
  BUBBLE_CARD_WIDTH,
  BUBBLE_PLACEMENT_GAP,
  BubblePlacementService,
} from './bubble-placement.service';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblePlacementService', () => {
  let temporaryDirectory: string;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let bubbles: BubblesService;
  let placements: BubblePlacementService;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-placement-'));
    const databasePath = join(temporaryDirectory, 'placement.sqlite');
    projectRepository = new SqliteProjectRepository(databasePath);
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    projects = new ProjectsService(projectRepository);
    bubbles = new BubblesService(projects, bubbleRepository);
    placements = new BubblePlacementService(projects, bubbleRepository);
  });

  afterEach(() => {
    bubbleRepository.onModuleDestroy();
    projectRepository.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('centers an empty placement in the visible world bounds', () => {
    const project = projects.create({
      title: 'Empty canvas',
      description: 'Place at the viewport center.',
    });

    expect(
      placements.place(project.id, {
        strategy: 'viewport',
        viewport_x: -100,
        viewport_y: 50,
        viewport_width: 1000,
        viewport_height: 800,
      }),
    ).toEqual({ position_x: 276, position_y: 373 });
  });

  it('returns deterministic, non-overlapping visible positions', () => {
    const project = projects.create({
      title: 'Busy canvas',
      description: 'Avoid occupied cards.',
    });
    const viewport = {
      strategy: 'viewport' as const,
      viewport_x: 0,
      viewport_y: 0,
      viewport_width: 1000,
      viewport_height: 800,
    };

    const firstPosition = placements.place(project.id, viewport);
    bubbles.create(project.id, {
      title: 'First',
      content: 'The centered bubble.',
      ...firstPosition,
    });
    const secondPosition = placements.place(project.id, viewport);

    expect(firstPosition).toEqual({ position_x: 376, position_y: 323 });
    expect(secondPosition).toEqual({
      position_x:
        firstPosition.position_x + BUBBLE_CARD_WIDTH + BUBBLE_PLACEMENT_GAP,
      position_y: firstPosition.position_y,
    });
    expect(placements.place(project.id, viewport)).toEqual(secondPosition);
    expect(secondPosition.position_x + BUBBLE_CARD_WIDTH).toBeLessThanOrEqual(
      viewport.viewport_width,
    );
    expect(secondPosition.position_y + BUBBLE_CARD_HEIGHT).toBeLessThanOrEqual(
      viewport.viewport_height,
    );
  });

  it('places external bubbles near the current project cluster only', () => {
    const owner = projects.create({
      title: 'Owner',
      description: 'Has an existing cluster.',
    });
    const other = projects.create({
      title: 'Other',
      description: 'Must not affect placement.',
    });
    bubbles.create(owner.id, {
      title: 'Owner bubble',
      content: 'Part of the owner cluster.',
      position_x: 120,
      position_y: 240,
    });
    bubbles.create(other.id, {
      title: 'Other bubble',
      content: 'At the owner candidate, but in another project.',
      position_x: 392,
      position_y: 240,
    });

    expect(placements.place(owner.id, { strategy: 'cluster' })).toEqual({
      position_x: 392,
      position_y: 240,
    });
    expect(placements.place(other.id, { strategy: 'cluster' })).toEqual({
      position_x: 664,
      position_y: 240,
    });
  });

  it('rejects invalid viewport geometry and missing projects', () => {
    const project = projects.create({
      title: 'Validation',
      description: 'Reject invalid placement requests.',
    });

    expect(() =>
      placements.place(project.id, {
        strategy: 'viewport',
        viewport_x: 0,
        viewport_y: 0,
        viewport_width: 0,
        viewport_height: 800,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      placements.place('missing-project', { strategy: 'cluster' }),
    ).toThrow(NotFoundException);
  });
});
