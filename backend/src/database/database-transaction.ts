import { Injectable } from '@nestjs/common';
import { DatabaseProvider } from './database.provider';

@Injectable()
export class DatabaseTransaction {
  private depth = 0;

  constructor(private readonly databaseProvider: DatabaseProvider) {}

  run<T>(operation: () => T): T {
    if (this.depth > 0) {
      return operation();
    }

    this.databaseProvider.connection.exec('BEGIN IMMEDIATE;');
    this.depth += 1;

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
    } finally {
      this.depth -= 1;
    }
  }
}
