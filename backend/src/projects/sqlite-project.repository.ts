import type { DatabaseSync } from 'node:sqlite';
import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from '../database/database.provider';
import { DatabaseTransaction } from '../database/database-transaction';
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
export class SqliteProjectRepository implements ProjectRepository {
  private readonly database: DatabaseSync;

  constructor(
    databaseProvider: DatabaseProvider,
    /**
     * Injected as the application-scoped instance; the default only serves
     * tests that construct this repository directly.
     */
    private readonly transactions: DatabaseTransaction = new DatabaseTransaction(
      databaseProvider,
    ),
  ) {
    this.database = databaseProvider.connection;
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

  delete(id: string): boolean {
    // Every project-owned table reaches `projects` by ON DELETE CASCADE, but
    // `bubbles` also references `territories` with ON DELETE RESTRICT, and
    // SQLite evaluates a RESTRICT the instant it cascades into the parent
    // rather than at the end of the statement. Whether the bubble cascade has
    // already emptied the table by then depends on the order SQLite walks the
    // child tables, which follows their `sqlite_master` order — and that
    // differs between a freshly migrated database and one built by applying
    // the migrations incrementally, where `territories` lands last.
    //
    // Deferring enforcement to COMMIT removes the dependency on that order.
    // Nothing is weakened: every constraint is still checked before the
    // transaction lands, and SQLite clears the pragma when it ends.
    return this.transactions.run(() => {
      this.database.exec('PRAGMA defer_foreign_keys = ON;');

      const result = this.database
        .prepare('DELETE FROM projects WHERE id = ?')
        .run(id);

      return result.changes > 0;
    });
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
