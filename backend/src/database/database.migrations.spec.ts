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
      ]);
      expect(database.prepare('PRAGMA user_version;').get()).toEqual({
        user_version: 5,
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
