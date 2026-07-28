import { DatabaseSync } from 'node:sqlite';
import {
  DATABASE_MIGRATIONS,
  runDatabaseMigrations,
  type DatabaseMigration,
} from './database.migrations';

describe('runDatabaseMigrations', () => {
  it('applies registered migrations in order and records the schema version', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT version, name
              FROM schema_migrations
              ORDER BY version ASC
            `,
          )
          .all(),
      ).toEqual([
        { version: 1, name: 'create-projects' },
        { version: 2, name: 'create-bubbles' },
        { version: 3, name: 'create-bubble-links' },
        { version: 4, name: 'create-discussions' },
        { version: 5, name: 'create-discussion-messages' },
        { version: 6, name: 'persist-discussion-context-items' },
      ]);
      expect(database.prepare('PRAGMA user_version;').get()).toEqual({
        user_version: 6,
      });
    } finally {
      database.close();
    }
  });

  it('does not reapply migrations already recorded in the ledger', () => {
    const database = new DatabaseSync(':memory:');

    try {
      runDatabaseMigrations(database);
      runDatabaseMigrations(database);

      expect(
        database
          .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
          .get(),
      ).toEqual({ count: DATABASE_MIGRATIONS.length });
    } finally {
      database.close();
    }
  });

  it('upgrades legacy discussions without reinterpreting their frozen JSON', () => {
    const database = new DatabaseSync(':memory:');

    try {
      database.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(database, DATABASE_MIGRATIONS.slice(0, 5));
      database
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
          'project-a',
          'Legacy project',
          'Legacy description',
          '2026-07-27T09:00:00.000Z',
          '2026-07-27T09:00:00.000Z',
          0,
          0,
          1,
        );
      database
        .prepare(
          `
            INSERT INTO discussions (
              id,
              project_id,
              title,
              frozen_context,
              created_at,
              updated_at,
              last_activity_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'discussion-a',
          'project-a',
          null,
          '{"historical_shape":{"content":"Keep exactly this"}}',
          '2026-07-27T10:00:00.000Z',
          '2026-07-27T10:00:00.000Z',
          '2026-07-27T10:00:00.000Z',
          null,
        );

      runDatabaseMigrations(database);

      expect(
        database
          .prepare(
            `
              SELECT
                frozen_context,
                context_version,
                expected_context_item_count,
                creation_idempotency_key,
                creation_request_fingerprint
              FROM discussions
              WHERE id = ?
            `,
          )
          .get('discussion-a'),
      ).toEqual({
        frozen_context: '{"historical_shape":{"content":"Keep exactly this"}}',
        context_version: null,
        expected_context_item_count: null,
        creation_idempotency_key: null,
        creation_request_fingerprint: null,
      });
    } finally {
      database.close();
    }
  });

  it('rolls back the complete schema update when a migration fails', () => {
    const database = new DatabaseSync(':memory:');
    const migrations: readonly DatabaseMigration[] = [
      {
        version: 1,
        name: 'create-first-table',
        sql: 'CREATE TABLE first_table (id INTEGER PRIMARY KEY) STRICT;',
      },
      {
        version: 2,
        name: 'fail-after-partial-ddl',
        sql: `
          CREATE TABLE partial_table (id INTEGER PRIMARY KEY) STRICT;
          THIS IS NOT VALID SQL;
        `,
      },
    ];

    try {
      expect(() => runDatabaseMigrations(database, migrations)).toThrow();
      expect(
        database
          .prepare(
            `
              SELECT name
              FROM sqlite_schema
              WHERE type = 'table'
              ORDER BY name ASC
            `,
          )
          .all(),
      ).toEqual([]);
      expect(database.prepare('PRAGMA user_version;').get()).toEqual({
        user_version: 0,
      });
    } finally {
      database.close();
    }
  });
});
