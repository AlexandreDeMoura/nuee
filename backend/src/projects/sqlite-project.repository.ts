import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CREATE_PROJECTS_MIGRATION } from './migrations/001-create-projects';
import {
  Project,
  ProjectRepository,
  UpdateProjectViewportInput,
} from './project.types';

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

@Injectable()
export class SqliteProjectRepository
  implements ProjectRepository, OnModuleDestroy
{
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(CREATE_PROJECTS_MIGRATION);
  }

  create(project: Project): Project {
    this.database
      .prepare(
        `
          INSERT INTO projects (
            id,
            title,
            description,
            created_at,
            updated_at,
            canvas_viewport_x,
            canvas_viewport_y,
            canvas_zoom
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        project.id,
        project.title,
        project.description,
        project.created_at,
        project.updated_at,
        project.canvas_viewport_x,
        project.canvas_viewport_y,
        project.canvas_zoom,
      );

    return project;
  }

  findAll(): Project[] {
    const rows = this.database
      .prepare(
        `
          SELECT *
          FROM projects
          ORDER BY updated_at DESC, created_at DESC, id ASC
        `,
      )
      .all() as unknown as ProjectRow[];

    return rows.map((row) => this.toProject(row));
  }

  findById(id: string): Project | undefined {
    const row = this.database
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as unknown as ProjectRow | undefined;

    return row ? this.toProject(row) : undefined;
  }

  updateDescription(
    id: string,
    description: string,
    updatedAt: string,
  ): Project | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE projects
          SET description = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(description, updatedAt, id);

    return result.changes === 0 ? undefined : this.findById(id);
  }

  updateViewport(
    id: string,
    viewport: UpdateProjectViewportInput,
  ): Project | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE projects
          SET canvas_viewport_x = ?, canvas_viewport_y = ?, canvas_zoom = ?
          WHERE id = ?
        `,
      )
      .run(
        viewport.canvas_viewport_x,
        viewport.canvas_viewport_y,
        viewport.canvas_zoom,
        id,
      );

    return result.changes === 0 ? undefined : this.findById(id);
  }

  onModuleDestroy(): void {
    this.database.close();
  }

  private toProject(row: ProjectRow): Project {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      canvas_viewport_x: row.canvas_viewport_x,
      canvas_viewport_y: row.canvas_viewport_y,
      canvas_zoom: row.canvas_zoom,
    };
  }
}
