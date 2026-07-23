import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { BubbleLinksService } from './bubble-links.service';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubbleLinksService', () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let bubbles: BubblesService;
  let links: BubbleLinksService;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubble-links-'));
    databasePath = join(temporaryDirectory, 'bubble-links.sqlite');
    projectRepository = new SqliteProjectRepository(databasePath);
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    projects = new ProjectsService(projectRepository);
    bubbles = new BubblesService(projects, bubbleRepository);
    links = new BubbleLinksService(projects, bubbles, bubbleRepository);
  });

  afterEach(() => {
    bubbleRepository.onModuleDestroy();
    projectRepository.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  function createProject(title = 'Link research') {
    return projects.create({ title, description: `${title} description` });
  }

  it('stores one canonical record regardless of endpoint order', () => {
    const project = createProject();
    const first = bubbles.create(project.id, {
      title: 'First',
      content: 'First bubble',
    });
    const second = bubbles.create(project.id, {
      title: 'Second',
      content: 'Second bubble',
    });

    const created = links.create(project.id, {
      bubble_a_id: second.id,
      bubble_b_id: first.id,
    });
    const duplicate = links.create(project.id, {
      bubble_a_id: first.id,
      bubble_b_id: second.id,
    });

    expect(created.bubble_a_id < created.bubble_b_id).toBe(true);
    expect(duplicate).toEqual(created);
    expect(links.list(project.id)).toEqual([created]);
  });

  it('rejects self-links and bubbles owned by another project', () => {
    const owner = createProject('Owner');
    const other = createProject('Other');
    const ownerBubble = bubbles.create(owner.id, {
      title: 'Owner bubble',
      content: 'Owned knowledge',
    });
    const otherBubble = bubbles.create(other.id, {
      title: 'Other bubble',
      content: 'Other knowledge',
    });

    expect(() =>
      links.create(owner.id, {
        bubble_a_id: ownerBubble.id,
        bubble_b_id: ownerBubble.id,
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      links.create(owner.id, {
        bubble_a_id: ownerBubble.id,
        bubble_b_id: otherBubble.id,
      }),
    ).toThrow(NotFoundException);
    expect(links.list(owner.id)).toEqual([]);
  });

  it('removes links symmetrically and reports a missing pair', () => {
    const project = createProject();
    const first = bubbles.create(project.id, {
      title: 'First',
      content: 'First bubble',
    });
    const second = bubbles.create(project.id, {
      title: 'Second',
      content: 'Second bubble',
    });
    links.create(project.id, {
      bubble_a_id: first.id,
      bubble_b_id: second.id,
    });

    links.delete(project.id, second.id, first.id);

    expect(links.list(project.id)).toEqual([]);
    expect(() => links.delete(project.id, first.id, second.id)).toThrow(
      NotFoundException,
    );
  });

  it('persists links across repository restarts and cascades bubble deletion', () => {
    const project = createProject();
    const first = bubbles.create(project.id, {
      title: 'First',
      content: 'First bubble',
    });
    const second = bubbles.create(project.id, {
      title: 'Second',
      content: 'Second bubble',
    });
    const created = links.create(project.id, {
      bubble_a_id: first.id,
      bubble_b_id: second.id,
    });

    bubbleRepository.onModuleDestroy();
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    bubbles = new BubblesService(projects, bubbleRepository);
    links = new BubbleLinksService(projects, bubbles, bubbleRepository);

    expect(links.list(project.id)).toEqual([created]);

    bubbles.delete(project.id, first.id);
    expect(links.list(project.id)).toEqual([]);
    expect(bubbles.get(project.id, second.id)).toEqual(second);
  });
});
