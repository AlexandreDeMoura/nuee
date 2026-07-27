import { Module } from '@nestjs/common';
import { PROJECT_REPOSITORY } from './project.types';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SqliteProjectRepository } from './sqlite-project.repository';

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    SqliteProjectRepository,
    {
      provide: PROJECT_REPOSITORY,
      useExisting: SqliteProjectRepository,
    },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
