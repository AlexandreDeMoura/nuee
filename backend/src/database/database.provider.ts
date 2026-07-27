import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { appConfig } from '../config/configuration';
import { runDatabaseMigrations } from './database.migrations';

@Injectable()
export class DatabaseProvider implements OnModuleDestroy {
  readonly connection: DatabaseSync;

  constructor(
    @Inject(appConfig.KEY)
    config: Pick<ConfigType<typeof appConfig>, 'databasePath'>,
  ) {
    const defaultDatabasePath = join(
      __dirname,
      '..',
      '..',
      'data',
      'nuee.sqlite',
    );
    const databasePath = config.databasePath ?? defaultDatabasePath;

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
