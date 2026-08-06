import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_DESCRIPTION_MAX_LENGTH } from '@nuee/shared-types';
import { DatabaseProvider } from '../database/database.provider';
import { SqliteProjectRepository } from './sqlite-project.repository';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let databaseProvider: DatabaseProvider;
  let repository: SqliteProjectRepository;
  let service: ProjectsService;

  function openDatabase(databasePath: string): void {
    databaseProvider = new DatabaseProvider({ databasePath });
    repository = new SqliteProjectRepository(databaseProvider);
    service = new ProjectsService(repository);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    openDatabase(':memory:');
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
    jest.useRealTimers();
  });

  it('creates a trimmed project with timestamps and viewport defaults', () => {
    jest.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));

    const project = service.create({
      title: '  Research launch  ',
      description: '  Explore the launch risks.  ',
    });

    expect(project.id).not.toHaveLength(0);
    expect(project).toEqual({
      id: project.id,
      title: 'Research launch',
      description: 'Explore the launch risks.',
      created_at: '2026-07-20T10:00:00.000Z',
      updated_at: '2026-07-20T10:00:00.000Z',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
  });

  it.each([
    [{ title: ' ', description: 'Valid' }, 'title', 'Title is required.'],
    [
      { title: 'Valid', description: ' ' },
      'description',
      'Description is required.',
    ],
    [
      {
        title: 'Valid',
        description: 'a'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1),
      },
      'description',
      `Description must be ${PROJECT_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    ],
  ])(
    'rejects invalid project input',
    (input, invalidField, expectedMessage) => {
      expect.assertions(2);

      try {
        service.create(input);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual({
          code: 'PROJECT_VALIDATION_FAILED',
          message: 'Project input is invalid.',
          field_errors: {
            [invalidField]: expectedMessage,
          },
        });
      }
    },
  );

  it('lists projects by most recently updated first', () => {
    jest.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
    const first = service.create({ title: 'First', description: 'First' });
    jest.setSystemTime(new Date('2026-07-20T11:00:00.000Z'));
    const second = service.create({ title: 'Second', description: 'Second' });

    expect(service.list().map((project) => project.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('moves a project to the front after its description is updated', () => {
    jest.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
    const first = service.create({ title: 'First', description: 'First' });
    jest.setSystemTime(new Date('2026-07-20T11:00:00.000Z'));
    const second = service.create({ title: 'Second', description: 'Second' });
    jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));

    service.updateDescription(first.id, { description: 'First revised' });

    expect(service.list().map((project) => project.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it('updates only the description and advances updated_at', () => {
    jest.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
    const original = service.create({
      title: 'Research',
      description: 'Original description',
    });

    const updated = service.updateDescription(original.id, {
      description: '  Revised description  ',
    });

    expect(updated).toEqual({
      ...original,
      description: 'Revised description',
      updated_at: '2026-07-20T10:00:00.001Z',
    });
  });

  it('persists viewport changes without changing updated_at or project ordering', () => {
    jest.setSystemTime(new Date('2026-07-20T10:00:00.000Z'));
    const first = service.create({ title: 'First', description: 'First' });
    jest.setSystemTime(new Date('2026-07-20T11:00:00.000Z'));
    const second = service.create({ title: 'Second', description: 'Second' });

    const updated = service.updateViewport(first.id, {
      canvas_viewport_x: 142.5,
      canvas_viewport_y: -88,
      canvas_zoom: 1.4,
    });

    expect(updated).toEqual({
      ...first,
      canvas_viewport_x: 142.5,
      canvas_viewport_y: -88,
      canvas_zoom: 1.4,
    });
    expect(updated.updated_at).toBe(first.updated_at);
    expect(service.list().map((project) => project.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it.each([
    [
      { canvas_viewport_x: 'left', canvas_viewport_y: 0, canvas_zoom: 1 },
      { canvas_viewport_x: 'Viewport X must be a finite number.' },
    ],
    [
      { canvas_viewport_x: 0, canvas_viewport_y: null, canvas_zoom: 1 },
      { canvas_viewport_y: 'Viewport Y must be a finite number.' },
    ],
    [
      { canvas_viewport_x: 0, canvas_viewport_y: 0, canvas_zoom: 3 },
      { canvas_zoom: 'Zoom must be between 0.25 and 2.' },
    ],
  ])('rejects invalid viewport input', (input, fieldErrors) => {
    const project = service.create({ title: 'Canvas', description: 'Canvas' });

    expect.assertions(2);

    try {
      service.updateViewport(project.id, input as never);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: fieldErrors,
      });
    }
  });

  it('returns a stable not-found error for reads and updates', () => {
    expect.assertions(6);

    for (const operation of [
      () => service.get('missing-project'),
      () =>
        service.updateDescription('missing-project', {
          description: 'New description',
        }),
      () =>
        service.updateViewport('missing-project', {
          canvas_viewport_x: 10,
          canvas_viewport_y: 20,
          canvas_zoom: 1.2,
        }),
    ]) {
      try {
        operation();
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          code: 'PROJECT_NOT_FOUND',
          message: 'Project "missing-project" was not found.',
        });
      }
    }
  });

  it('persists projects when the repository is reopened', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nuee-projects-'));
    const databasePath = join(temporaryDirectory, 'projects.sqlite');

    databaseProvider.onModuleDestroy();
    openDatabase(databasePath);
    const created = service.create({
      title: 'Persistent project',
      description: 'Survives a process restart.',
    });

    databaseProvider.onModuleDestroy();
    openDatabase(databasePath);

    expect(service.get(created.id)).toEqual(created);

    databaseProvider.onModuleDestroy();
    rmSync(temporaryDirectory, { recursive: true });
    openDatabase(':memory:');
  });
});
