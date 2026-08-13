import { NotFoundException } from '@nestjs/common';
import { DatabaseProvider } from '../database/database.provider';
import { ProjectDeletionService } from './project-deletion.service';
import { ProjectsService } from './projects.service';
import { SqliteProjectRepository } from './sqlite-project.repository';
import type { Project, ProjectDocumentFilePurger } from './project.types';

describe('ProjectDeletionService', () => {
  const timestamp = '2026-08-01T09:00:00.000Z';

  let databaseProvider: DatabaseProvider;
  let repository: SqliteProjectRepository;
  let projects: ProjectsService;
  let service: ProjectDeletionService;
  let fileReferences: Map<string, string[]>;
  let removeFiles: jest.Mock<Promise<number>, [string, readonly string[]]>;
  let listedWhileProjectExisted: boolean | undefined;

  function countRows(table: string): number {
    const row = databaseProvider.connection
      .prepare(`SELECT COUNT(*) AS total FROM ${table}`)
      .get() as unknown as { total: number };

    return row.total;
  }

  function createProject(): Project {
    return projects.create({
      title: 'Deletable project',
      description: 'A project that will be removed.',
    });
  }

  function seedProjectGraph(projectId: string): void {
    const run = (sql: string, ...parameters: unknown[]): void => {
      databaseProvider.connection.prepare(sql).run(...(parameters as never[]));
    };

    run(
      `INSERT INTO territories (id, project_id, kind, title, position_x, position_y, visible_count, created_at, updated_at)
       VALUES ('ter-1', ?, 'ungrouped', 'Ungrouped', 0, 0, 5, ?, ?)`,
      projectId,
      timestamp,
      timestamp,
    );
    run(
      `INSERT INTO bubbles (id, project_id, territory_id, title, content, created_at, updated_at)
       VALUES ('bub-1', ?, 'ter-1', 'First', 'Body', ?, ?)`,
      projectId,
      timestamp,
      timestamp,
    );
    run(
      `INSERT INTO bubbles (id, project_id, territory_id, title, content, created_at, updated_at)
       VALUES ('bub-2', ?, 'ter-1', 'Second', 'Body', ?, ?)`,
      projectId,
      timestamp,
      timestamp,
    );
    run(
      `INSERT INTO bubble_links (id, project_id, bubble_a_id, bubble_b_id, created_at)
       VALUES ('lnk-1', ?, 'bub-1', 'bub-2', ?)`,
      projectId,
      timestamp,
    );
    run(
      `INSERT INTO discussions (id, project_id, title, frozen_context, created_at, updated_at, last_activity_at)
       VALUES ('dis-1', ?, 'A discussion', '{}', ?, ?, ?)`,
      projectId,
      timestamp,
      timestamp,
      timestamp,
    );
    run(
      `INSERT INTO discussion_messages (id, discussion_id, role, content, status, created_at)
       VALUES ('msg-1', 'dis-1', 'user', 'Hello', 'completed', ?)`,
      timestamp,
    );
  }

  beforeEach(() => {
    databaseProvider = new DatabaseProvider({ databasePath: ':memory:' });
    repository = new SqliteProjectRepository(databaseProvider);
    projects = new ProjectsService(repository);
    fileReferences = new Map();
    listedWhileProjectExisted = undefined;
    removeFiles = jest.fn((_projectId: string, references: readonly string[]) =>
      Promise.resolve(references.length),
    );

    const documentFiles: ProjectDocumentFilePurger = {
      listProjectFileReferences: (projectId) => {
        listedWhileProjectExisted =
          repository.findById(projectId) !== undefined;

        return fileReferences.get(projectId) ?? [];
      },
      removeFiles,
    };

    service = new ProjectDeletionService(projects, repository, documentFiles);
  });

  afterEach(() => {
    databaseProvider.onModuleDestroy();
  });

  it('removes the project and cascades every project-owned row', async () => {
    const project = createProject();
    seedProjectGraph(project.id);

    expect(countRows('bubbles')).toBe(2);

    await service.delete(project.id);

    expect(projects.list()).toEqual([]);
    expect(countRows('projects')).toBe(0);
    expect(countRows('territories')).toBe(0);
    expect(countRows('bubbles')).toBe(0);
    expect(countRows('bubble_links')).toBe(0);
    expect(countRows('discussions')).toBe(0);
    expect(countRows('discussion_messages')).toBe(0);
  });

  it('rejects an unknown project without touching document files', async () => {
    expect.assertions(3);

    try {
      await service.delete('missing-project');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
    }

    expect(removeFiles).not.toHaveBeenCalled();
  });

  it('collects document file references before the cascade destroys them', async () => {
    const project = createProject();
    fileReferences.set(project.id, ['originals/ab/one', 'originals/cd/two']);

    await service.delete(project.id);

    expect(listedWhileProjectExisted).toBe(true);
    expect(removeFiles).toHaveBeenCalledWith(project.id, [
      'originals/ab/one',
      'originals/cd/two',
    ]);
  });

  it('skips the purge when the project owns no documents', async () => {
    const project = createProject();

    await service.delete(project.id);

    expect(removeFiles).not.toHaveBeenCalled();
  });

  it('keeps the deletion successful when an original cannot be unlinked', async () => {
    const project = createProject();
    fileReferences.set(project.id, ['originals/ab/one', 'originals/cd/two']);
    removeFiles.mockResolvedValue(1);

    await expect(service.delete(project.id)).resolves.toBeUndefined();

    expect(projects.list()).toEqual([]);
  });
});
