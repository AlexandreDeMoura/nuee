import { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteBubbleRepository } from '../bubbles/sqlite-bubble.repository';
import { SqliteProjectRepository } from '../projects/sqlite-project.repository';
import { DatabaseProvider } from './database.provider';

describe('DatabaseProvider', () => {
  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), 'nuee-database-provider-'),
  );
  const databasePath = join(temporaryDirectory, 'nested', 'nuee.sqlite');
  let databaseProvider: DatabaseProvider | undefined;

  afterEach(() => {
    databaseProvider?.onModuleDestroy();
    databaseProvider = undefined;
  });

  afterAll(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('owns one configured connection shared by feature repositories', () => {
    databaseProvider = new DatabaseProvider(
      new ConfigService({ PROJECT_DATABASE_PATH: databasePath }),
    );

    new SqliteProjectRepository(databaseProvider);
    new SqliteBubbleRepository(databaseProvider);

    expect(existsSync(databasePath)).toBe(true);
    expect(
      databaseProvider.connection.prepare('PRAGMA foreign_keys;').get(),
    ).toEqual({ foreign_keys: 1 });
    expect(
      databaseProvider.connection.prepare('PRAGMA busy_timeout;').get(),
    ).toEqual({ timeout: 5000 });
    expect(
      databaseProvider.connection
        .prepare(
          `
            SELECT name
            FROM sqlite_schema
            WHERE type = 'table'
            ORDER BY name ASC
          `,
        )
        .all(),
    ).toEqual([
      { name: 'bubble_links' },
      { name: 'bubbles' },
      { name: 'projects' },
      { name: 'schema_migrations' },
    ]);
  });

  it('closes its connection during module shutdown', () => {
    databaseProvider = new DatabaseProvider(
      new ConfigService({ PROJECT_DATABASE_PATH: ':memory:' }),
    );
    const connection = databaseProvider.connection;

    databaseProvider.onModuleDestroy();
    databaseProvider = undefined;

    expect(() => connection.prepare('SELECT 1;')).toThrow();
  });
});
