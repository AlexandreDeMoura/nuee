import type { DatabaseSync } from 'node:sqlite';
import { CREATE_BUBBLES_MIGRATION } from '../bubbles/migrations/002-create-bubbles';
import { CREATE_BUBBLE_LINKS_MIGRATION } from '../bubbles/migrations/003-create-bubble-links';
import { COMPLETE_DISCUSSION_EXTRACTION_PROVENANCE_MIGRATION } from '../bubbles/migrations/007-complete-discussion-extraction-provenance';
import { CREATE_DISCUSSIONS_MIGRATION } from '../discussions/migrations/004-create-discussions';
import { CREATE_DISCUSSION_MESSAGES_MIGRATION } from '../discussions/migrations/005-create-discussion-messages';
import { PERSIST_DISCUSSION_CONTEXT_ITEMS_MIGRATION } from '../discussions/migrations/006-persist-discussion-context-items';
import { PERSIST_DISCUSSION_SEARCH_ATTRIBUTION_MIGRATION } from '../discussions/migrations/010-persist-discussion-search-attribution';
import { CREATE_DOCUMENTS_MIGRATION } from '../documents/migrations/009-create-documents';
import { CREATE_KNOWLEDGE_EXTRACTION_ATTEMPTS_MIGRATION } from '../knowledge-extraction/migrations/008-create-knowledge-extraction-attempts';
import { PERSIST_EXTRACTION_INTENT_MIGRATION } from '../knowledge-extraction/migrations/011-persist-extraction-intent';
import { CREATE_PROJECTS_MIGRATION } from '../projects/migrations/001-create-projects';
import { WIDEN_PROJECT_DESCRIPTION_MIGRATION } from '../projects/migrations/012-widen-project-description';

export interface DatabaseMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

interface AppliedMigration {
  version: number;
  name: string;
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'create-projects',
    sql: CREATE_PROJECTS_MIGRATION,
  },
  {
    version: 2,
    name: 'create-bubbles',
    sql: CREATE_BUBBLES_MIGRATION,
  },
  {
    version: 3,
    name: 'create-bubble-links',
    sql: CREATE_BUBBLE_LINKS_MIGRATION,
  },
  {
    version: 4,
    name: 'create-discussions',
    sql: CREATE_DISCUSSIONS_MIGRATION,
  },
  {
    version: 5,
    name: 'create-discussion-messages',
    sql: CREATE_DISCUSSION_MESSAGES_MIGRATION,
  },
  {
    version: 6,
    name: 'persist-discussion-context-items',
    sql: PERSIST_DISCUSSION_CONTEXT_ITEMS_MIGRATION,
  },
  {
    version: 7,
    name: 'complete-discussion-extraction-provenance',
    sql: COMPLETE_DISCUSSION_EXTRACTION_PROVENANCE_MIGRATION,
  },
  {
    version: 8,
    name: 'create-knowledge-extraction-attempts',
    sql: CREATE_KNOWLEDGE_EXTRACTION_ATTEMPTS_MIGRATION,
  },
  {
    version: 9,
    name: 'create-documents',
    sql: CREATE_DOCUMENTS_MIGRATION,
  },
  {
    version: 10,
    name: 'persist-discussion-search-attribution',
    sql: PERSIST_DISCUSSION_SEARCH_ATTRIBUTION_MIGRATION,
  },
  {
    version: 11,
    name: 'persist-extraction-intent',
    sql: PERSIST_EXTRACTION_INTENT_MIGRATION,
  },
  {
    version: 12,
    name: 'widen-project-description',
    sql: WIDEN_PROJECT_DESCRIPTION_MIGRATION,
  },
];

const CREATE_MIGRATION_LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT;
`;

function validateMigrationDefinitions(
  migrations: readonly DatabaseMigration[],
): void {
  const names = new Set<string>();

  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;

    if (migration.version !== expectedVersion) {
      throw new Error(
        `Database migration versions must be consecutive from 1; expected ${expectedVersion}, received ${migration.version}.`,
      );
    }

    if (migration.name.trim().length === 0 || names.has(migration.name)) {
      throw new Error(
        `Database migration ${migration.version} must have a unique, non-empty name.`,
      );
    }

    names.add(migration.name);
  });
}

function validateAppliedMigrations(
  appliedMigrations: AppliedMigration[],
  migrations: readonly DatabaseMigration[],
): void {
  appliedMigrations.forEach((appliedMigration, index) => {
    const expectedVersion = index + 1;
    const registeredMigration = migrations[index];

    if (appliedMigration.version !== expectedVersion) {
      throw new Error(
        `Database migration ledger is not consecutive at version ${expectedVersion}.`,
      );
    }

    if (registeredMigration === undefined) {
      throw new Error(
        `Database schema version ${appliedMigration.version} is newer than this application supports.`,
      );
    }

    if (appliedMigration.name !== registeredMigration.name) {
      throw new Error(
        `Database migration ${appliedMigration.version} is recorded as "${appliedMigration.name}" but registered as "${registeredMigration.name}".`,
      );
    }
  });
}

function getUserVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version;').get() as unknown as {
    user_version: number;
  };

  return row.user_version;
}

function getForeignKeysEnabled(database: DatabaseSync): boolean {
  const row = database.prepare('PRAGMA foreign_keys;').get() as unknown as {
    foreign_keys: number;
  };

  return row.foreign_keys === 1;
}

/**
 * Replacing a CHECK constraint or a column type in SQLite means rebuilding the
 * table, and a rebuild drops the original. With foreign keys enabled that drop
 * runs an implicit DELETE FROM which fires ON DELETE CASCADE on every child
 * table, so a schema change would silently delete application data.
 *
 * SQLite's documented rebuild procedure disables foreign keys around the work,
 * and `PRAGMA foreign_keys` is a no-op inside a transaction, so enforcement is
 * suspended here rather than in an individual migration. Migrations are schema
 * definitions and never rely on cascade behaviour; `PRAGMA foreign_key_check`
 * runs after the commit so a migration that leaves a dangling reference fails
 * loudly instead of degrading the database silently.
 */
export function runDatabaseMigrations(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
): void {
  validateMigrationDefinitions(migrations);

  const foreignKeysWereEnabled = getForeignKeysEnabled(database);

  if (foreignKeysWereEnabled) {
    database.exec('PRAGMA foreign_keys = OFF;');
  }

  try {
    runMigrationTransaction(database, migrations);

    const violations = database.prepare('PRAGMA foreign_key_check;').all();

    if (violations.length > 0) {
      throw new Error(
        `Database migrations left ${violations.length} foreign key violation(s).`,
      );
    }
  } finally {
    if (foreignKeysWereEnabled) {
      database.exec('PRAGMA foreign_keys = ON;');
    }
  }
}

function runMigrationTransaction(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[],
): void {
  database.exec('BEGIN IMMEDIATE;');

  try {
    database.exec(CREATE_MIGRATION_LEDGER);

    const appliedMigrations = database
      .prepare(
        `
          SELECT version, name
          FROM schema_migrations
          ORDER BY version ASC
        `,
      )
      .all() as unknown as AppliedMigration[];

    validateAppliedMigrations(appliedMigrations, migrations);

    const userVersion = getUserVersion(database);
    const latestVersion = migrations.at(-1)?.version ?? 0;

    if (userVersion > latestVersion) {
      throw new Error(
        `Database user version ${userVersion} is newer than this application supports (${latestVersion}).`,
      );
    }

    const recordMigration = database.prepare(
      `
        INSERT INTO schema_migrations (version, name)
        VALUES (?, ?)
      `,
    );

    for (const migration of migrations.slice(appliedMigrations.length)) {
      database.exec(migration.sql);
      recordMigration.run(migration.version, migration.name);
    }

    database.exec(`PRAGMA user_version = ${latestVersion};`);
    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}
