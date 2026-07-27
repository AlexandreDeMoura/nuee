import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

    this.connection = new DatabaseSync(databasePath);
    this.connection.exec('PRAGMA foreign_keys = ON;');
  }

  onModuleDestroy(): void {
    this.connection.close();
  }
}
