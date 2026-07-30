import type { DatabaseSync } from 'node:sqlite';
import { CREATE_BUBBLES_MIGRATION } from '../bubbles/migrations/002-create-bubbles';
import { CREATE_BUBBLE_LINKS_MIGRATION } from '../bubbles/migrations/003-create-bubble-links';
import { COMPLETE_DISCUSSION_EXTRACTION_PROVENANCE_MIGRATION } from '../bubbles/migrations/007-complete-discussion-extraction-provenance';
import { CREATE_DISCUSSIONS_MIGRATION } from '../discussions/migrations/004-create-discussions';
import { CREATE_DISCUSSION_MESSAGES_MIGRATION } from '../discussions/migrations/005-create-discussion-messages';
import { PERSIST_DISCUSSION_CONTEXT_ITEMS_MIGRATION } from '../discussions/migrations/006-persist-discussion-context-items';
import { CREATE_DOCUMENTS_MIGRATION } from '../documents/migrations/009-create-documents';
import { CREATE_KNOWLEDGE_EXTRACTION_ATTEMPTS_MIGRATION } from '../knowledge-extraction/migrations/008-create-knowledge-extraction-attempts';
import { CREATE_PROJECTS_MIGRATION } from '../projects/migrations/001-create-projects';

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

export function runDatabaseMigrations(
  database: DatabaseSync,
  migrations: readonly DatabaseMigration[] = DATABASE_MIGRATIONS,
): void {
  validateMigrationDefinitions(migrations);
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
