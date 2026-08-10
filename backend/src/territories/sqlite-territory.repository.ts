import { Injectable } from '@nestjs/common';
import type { DatabaseSync } from 'node:sqlite';
import { DatabaseProvider } from '../database/database.provider';
import type {
  PersistedTerritoryPosition,
  Territory,
  TerritoryRepository,
} from './territory.types';

interface CountRow {
  count: number;
}

@Injectable()
export class SqliteTerritoryRepository implements TerritoryRepository {
  private readonly database: DatabaseSync;

  constructor(databaseProvider: DatabaseProvider) {
    this.database = databaseProvider.connection;
  }

  create(territory: Territory): Territory {
    this.database
      .prepare(
        `
          INSERT INTO territories (
            id, project_id, kind, title, position_x, position_y,
            visible_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        territory.id,
        territory.project_id,
        territory.kind,
        territory.title,
        territory.position_x,
        territory.position_y,
        territory.visible_count,
        territory.created_at,
        territory.updated_at,
      );

    return territory;
  }

  findAllByProjectId(projectId: string): Territory[] {
    return this.database
      .prepare(
        `
          SELECT *
          FROM territories
          WHERE project_id = ?
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all(projectId) as unknown as Territory[];
  }

  findByProjectAndId(
    projectId: string,
    territoryId: string,
  ): Territory | undefined {
    return this.database
      .prepare('SELECT * FROM territories WHERE project_id = ? AND id = ?')
      .get(projectId, territoryId) as unknown as Territory | undefined;
  }

  findUngroupedByProjectId(projectId: string): Territory | undefined {
    return this.database
      .prepare(
        `
          SELECT *
          FROM territories
          WHERE project_id = ? AND kind = 'ungrouped'
        `,
      )
      .get(projectId) as unknown as Territory | undefined;
  }

  countBubbles(projectId: string, territoryId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM bubbles
          WHERE project_id = ? AND territory_id = ?
        `,
      )
      .get(projectId, territoryId) as unknown as CountRow;

    return row.count;
  }

  updateVisibleCount(
    projectId: string,
    territoryId: string,
    visibleCount: number,
    updatedAt: string,
  ): Territory | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE territories
          SET visible_count = ?, updated_at = ?
          WHERE project_id = ? AND id = ?
        `,
      )
      .run(visibleCount, updatedAt, projectId, territoryId);

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, territoryId);
  }

  updatePosition(
    projectId: string,
    territoryId: string,
    positionX: number,
    positionY: number,
    updatedAt: string,
  ): Territory | undefined {
    const result = this.database
      .prepare(
        `
          UPDATE territories
          SET position_x = ?, position_y = ?, updated_at = ?
          WHERE project_id = ? AND id = ?
        `,
      )
      .run(positionX, positionY, updatedAt, projectId, territoryId);

    return result.changes === 0
      ? undefined
      : this.findByProjectAndId(projectId, territoryId);
  }

  updatePositions(
    projectId: string,
    positions: PersistedTerritoryPosition[],
  ): Territory[] {
    const statement = this.database.prepare(
      `
        UPDATE territories
        SET position_x = ?, position_y = ?, updated_at = ?
        WHERE project_id = ? AND id = ?
      `,
    );

    this.database.exec('BEGIN IMMEDIATE;');

    try {
      for (const position of positions) {
        const result = statement.run(
          position.position_x,
          position.position_y,
          position.updated_at,
          projectId,
          position.territory_id,
        );

        if (result.changes === 0) {
          throw new Error(
            `Territory "${position.territory_id}" was not available for batch positioning.`,
          );
        }
      }

      this.database.exec('COMMIT;');
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }

    return positions.map((position) => {
      const territory = this.findByProjectAndId(
        projectId,
        position.territory_id,
      );

      if (!territory) {
        throw new Error(
          `Territory "${position.territory_id}" was not available after batch positioning.`,
        );
      }

      return territory;
    });
  }

  deleteComposedIfEmpty(projectId: string, territoryId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM territories
          WHERE
            project_id = ?
            AND id = ?
            AND kind = 'composed'
            AND NOT EXISTS (
              SELECT 1
              FROM bubbles
              WHERE
                bubbles.project_id = territories.project_id
                AND bubbles.territory_id = territories.id
            )
        `,
      )
      .run(projectId, territoryId);

    return result.changes > 0;
  }

  deleteComposedByIds(projectId: string, territoryIds: string[]): void {
    if (territoryIds.length === 0) {
      return;
    }

    const statement = this.database.prepare(
      `
        DELETE FROM territories
        WHERE project_id = ? AND id = ? AND kind = 'composed'
      `,
    );

    for (const territoryId of territoryIds) {
      const result = statement.run(projectId, territoryId);

      if (result.changes === 0) {
        throw new Error(
          `Composed territory "${territoryId}" was not available for replacement.`,
        );
      }
    }
  }
}
