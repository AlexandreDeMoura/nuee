import { Global, Module } from '@nestjs/common';
import { DatabaseProvider } from './database.provider';
import { DatabaseTransaction } from './database-transaction';

@Global()
@Module({
  providers: [DatabaseProvider, DatabaseTransaction],
  exports: [DatabaseProvider, DatabaseTransaction],
})
export class DatabaseModule {}
