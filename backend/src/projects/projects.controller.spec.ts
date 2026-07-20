import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SqliteProjectRepository } from './sqlite-project.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let repository: SqliteProjectRepository;

  beforeEach(() => {
    repository = new SqliteProjectRepository(':memory:');
    controller = new ProjectsController(new ProjectsService(repository));
  });

  afterEach(() => {
    repository.onModuleDestroy();
  });

  it('supports the create, list, read, and description-update operations', () => {
    const created = controller.create({
      title: '  Project API  ',
      description: '  Initial description  ',
    });

    expect(created).toMatchObject({
      title: 'Project API',
      description: 'Initial description',
      canvas_viewport_x: 0,
      canvas_viewport_y: 0,
      canvas_zoom: 1,
    });
    expect(controller.list()).toEqual([created]);
    expect(controller.get(created.id)).toEqual(created);
    expect(
      controller.updateDescription(created.id, {
        description: 'Updated description',
      }),
    ).toMatchObject({
      id: created.id,
      title: 'Project API',
      description: 'Updated description',
    });
  });

  it('returns a stable validation error', () => {
    expect.assertions(2);

    try {
      controller.create({ title: '', description: 'Description' });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'PROJECT_VALIDATION_FAILED',
        message: 'Project input is invalid.',
        field_errors: {
          title: 'Title is required.',
        },
      });
    }
  });

  it('returns a stable not-found error', () => {
    expect.assertions(2);

    try {
      controller.get('missing-project');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toEqual({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project "missing-project" was not found.',
      });
    }
  });
});
