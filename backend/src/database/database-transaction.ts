import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from './database.provider';

@Injectable()
export class DatabaseTransaction {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  run<T>(operation: () => T): T {
    this.databaseProvider.connection.exec('BEGIN IMMEDIATE;');

    try {
      const result = operation();
      this.databaseProvider.connection.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.databaseProvider.connection.exec('ROLLBACK;');
      } catch {
        // Preserve the workflow error when SQLite has already ended the transaction.
      }

      throw error;
    }
  }
}
