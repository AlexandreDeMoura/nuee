import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { PROJECT_REPOSITORY } from './project.types';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SqliteProjectRepository } from './sqlite-project.repository';

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    {
      provide: PROJECT_REPOSITORY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SqliteProjectRepository => {
        const defaultDatabasePath = join(
          __dirname,
          '..',
          '..',
          'data',
          'nuee.sqlite',
        );

        return new SqliteProjectRepository(
          config.get<string>('PROJECT_DATABASE_PATH') ?? defaultDatabasePath,
        );
      },
    },
  ],
})
export class ProjectsModule {}
