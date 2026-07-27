import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runDatabaseMigrations } from './database.migrations';

@Injectable()
export class DatabaseProvider implements OnModuleDestroy {
  readonly connection: DatabaseSync;

  constructor(config: ConfigService) {
    const defaultDatabasePath = join(
      __dirname,
      '..',
      '..',
      'data',
      'nuee.sqlite',
    );
    const databasePath =
      config.get<string>('PROJECT_DATABASE_PATH') ?? defaultDatabasePath;

    if (databasePath !== ':memory:') {
      mkdirSync(dirname(databasePath), { recursive: true });
    }

    const connection = new DatabaseSync(databasePath);

    try {
      connection.exec('PRAGMA busy_timeout = 5000;');
      connection.exec('PRAGMA foreign_keys = ON;');
      runDatabaseMigrations(connection);
    } catch (error) {
      connection.close();
      throw error;
    }

    this.connection = connection;
  }

  onModuleDestroy(): void {
    this.connection.close();
  }
}
