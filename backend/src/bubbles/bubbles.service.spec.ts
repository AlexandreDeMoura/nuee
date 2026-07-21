import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectsService } from '../projects/projects.service';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

describe('BubblesService', () => {
  let temporaryDirectory: string;
  let databasePath: string;
  let projectRepository: SqliteProjectRepository;
  let bubbleRepository: SqliteBubbleRepository;
  let projects: ProjectsService;
  let service: BubblesService;

  beforeEach(() => {
    jest.useFakeTimers();
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-bubbles-'));
    databasePath = join(temporaryDirectory, 'bubbles.sqlite');
    projectRepository = new SqliteProjectRepository(databasePath);
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    projects = new ProjectsService(projectRepository);
    service = new BubblesService(projects, bubbleRepository);
  });

  afterEach(() => {
    bubbleRepository.onModuleDestroy();
    projectRepository.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true, force: true });
    jest.useRealTimers();
  });

  function createProject(title = 'Research') {
    return projects.create({ title, description: `${title} description` });
  }

  it('creates a trimmed manual bubble with persistence defaults', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();

    const bubble = service.create(project.id, {
      title: '  Decision criteria  ',
      summary: '   ',
      content: '  Prefer reversible choices.  ',
    });

    expect(bubble.id).not.toHaveLength(0);
    expect(bubble).toEqual({
      id: bubble.id,
      project_id: project.id,
      title: 'Decision criteria',
      summary: null,
      content: 'Prefer reversible choices.',
      position_x: 0,
      position_y: 0,
      created_at: '2026-07-21T09:00:00.000Z',
      updated_at: '2026-07-21T09:00:00.000Z',
      source_kind: 'manual',
      source_discussion_id: null,
      source_message_ids: [],
    });
    expect(service.list(project.id)).toEqual([bubble]);
    expect(service.get(project.id, bubble.id)).toEqual(bubble);
  });

  it('accepts an optional summary and initial finite position', () => {
    const project = createProject();

    const bubble = service.create(project.id, {
      title: 'Placed bubble',
      summary: '  A concise summary.  ',
      content: 'Full content',
      position_x: -125.5,
      position_y: 240,
    });

    expect(bubble).toMatchObject({
      summary: 'A concise summary.',
      position_x: -125.5,
      position_y: 240,
    });
  });

  it.each([
    [{ title: ' ', content: 'Valid' }, 'title', 'Title is required.'],
    [{ title: 'Valid', content: ' ' }, 'content', 'Content is required.'],
    [
      { title: 'Valid', content: 'Valid', summary: 42 },
      'summary',
      'Summary must be text.',
    ],
    [
      { title: 'Valid', content: 'Valid', position_x: Number.NaN },
      'position_x',
      'Horizontal position must be a finite number.',
    ],
    [
      {
        title: 'Valid',
        content: 'Valid',
        position_y: Number.POSITIVE_INFINITY,
      },
      'position_y',
      'Vertical position must be a finite number.',
    ],
  ])('rejects invalid create input', (input, field, message) => {
    const project = createProject();

    expect(() => service.create(project.id, input as never)).toThrow(
      BadRequestException,
    );

    try {
      service.create(project.id, input as never);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('updates bubble content fields and advances updated_at', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const original = service.create(project.id, {
      title: 'Original title',
      summary: 'Original summary',
      content: 'Original content',
      position_x: 12,
      position_y: 24,
    });

    const updated = service.update(project.id, original.id, {
      title: '  Revised title  ',
      summary: null,
    });

    expect(updated).toEqual({
      ...original,
      title: 'Revised title',
      summary: null,
      updated_at: '2026-07-21T09:00:00.001Z',
    });
    expect(updated.content).toBe(original.content);
    expect(updated.position_x).toBe(original.position_x);
    expect(updated.position_y).toBe(original.position_y);
  });

  it.each([
    [{}, 'content', 'At least one content field must be provided.'],
    [{ title: ' ' }, 'title', 'Title is required.'],
    [{ content: '' }, 'content', 'Content is required.'],
    [{ summary: 12 }, 'summary', 'Summary must be text.'],
  ])('rejects invalid content updates', (input, field, message) => {
    const project = createProject();
    const bubble = service.create(project.id, {
      title: 'Bubble',
      content: 'Content',
    });

    try {
      service.update(project.id, bubble.id, input as never);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('repositions without changing content updated_at or another bubble', () => {
    jest.setSystemTime(new Date('2026-07-21T09:00:00.000Z'));
    const project = createProject();
    const movedBubble = service.create(project.id, {
      title: 'Moved',
      content: 'Moved content',
    });
    const untouchedBubble = service.create(project.id, {
      title: 'Untouched',
      content: 'Untouched content',
      position_x: 50,
      position_y: 75,
    });
    jest.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));

    const repositioned = service.reposition(project.id, movedBubble.id, {
      position_x: -80.25,
      position_y: 320.5,
    });

    expect(repositioned).toEqual({
      ...movedBubble,
      position_x: -80.25,
      position_y: 320.5,
    });
    expect(repositioned.updated_at).toBe(movedBubble.updated_at);
    expect(service.get(project.id, untouchedBubble.id)).toEqual(
      untouchedBubble,
    );
  });

  it.each([
    [
      { position_x: '0', position_y: 1 },
      'position_x',
      'Horizontal position must be a finite number.',
    ],
    [
      { position_x: 0, position_y: undefined },
      'position_y',
      'Vertical position must be a finite number.',
    ],
  ])('rejects invalid reposition input', (input, field, message) => {
    const project = createProject();
    const bubble = service.create(project.id, {
      title: 'Bubble',
      content: 'Content',
    });

    try {
      service.reposition(project.id, bubble.id, input as never);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'BUBBLE_VALIDATION_FAILED',
        message: 'Bubble input is invalid.',
        field_errors: { [field]: message },
      });
    }
  });

  it('scopes list, read, edit, reposition, and delete to the project', () => {
    const owningProject = createProject('Owner');
    const otherProject = createProject('Other');
    const bubble = service.create(owningProject.id, {
      title: 'Private to owner',
      content: 'Project-scoped knowledge',
    });

    expect(service.list(otherProject.id)).toEqual([]);

    const crossProjectOperations = [
      () => service.get(otherProject.id, bubble.id),
      () =>
        service.update(otherProject.id, bubble.id, { title: 'Unauthorized' }),
      () =>
        service.reposition(otherProject.id, bubble.id, {
          position_x: 1,
          position_y: 2,
        }),
      () => service.delete(otherProject.id, bubble.id),
    ];

    for (const operation of crossProjectOperations) {
      try {
        operation();
        throw new Error('Expected the cross-project operation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'BUBBLE_NOT_FOUND',
          message: `Bubble "${bubble.id}" was not found in project "${otherProject.id}".`,
        });
      }
    }

    expect(service.get(owningProject.id, bubble.id)).toEqual(bubble);
  });

  it('returns stable errors for missing projects and bubble identifiers', () => {
    const project = createProject();

    expect(() => service.list('missing-project')).toThrow(NotFoundException);

    for (const operation of [
      () => service.get(project.id, 'missing-bubble'),
      () => service.update(project.id, 'missing-bubble', { title: 'New' }),
      () =>
        service.reposition(project.id, 'missing-bubble', {
          position_x: 1,
          position_y: 2,
        }),
      () => service.delete(project.id, 'missing-bubble'),
    ]) {
      try {
        operation();
        throw new Error('Expected the missing bubble operation to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'BUBBLE_NOT_FOUND',
          message: `Bubble "missing-bubble" was not found in project "${project.id}".`,
        });
      }
    }
  });

  it('deletes a bubble without changing other bubbles', () => {
    const project = createProject();
    const deleted = service.create(project.id, {
      title: 'Delete me',
      content: 'Temporary',
    });
    const retained = service.create(project.id, {
      title: 'Keep me',
      content: 'Durable',
    });

    service.delete(project.id, deleted.id);

    expect(service.list(project.id)).toEqual([retained]);
    expect(() => service.get(project.id, deleted.id)).toThrow(
      NotFoundException,
    );
  });

  it('persists bubbles when the repository is reopened', () => {
    const project = createProject();
    const created = service.create(project.id, {
      title: 'Persistent bubble',
      content: 'Survives a process restart.',
      position_x: 10,
      position_y: -20,
    });

    bubbleRepository.onModuleDestroy();
    bubbleRepository = new SqliteBubbleRepository(databasePath);
    service = new BubblesService(projects, bubbleRepository);

    expect(service.get(project.id, created.id)).toEqual(created);
  });
});
