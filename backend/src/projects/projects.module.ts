import { forwardRef, Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PROJECT_REPOSITORY } from './project.types';
import { ProjectDeletionService } from './project-deletion.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SqliteProjectRepository } from './sqlite-project.repository';

@Module({
  imports: [forwardRef(() => DocumentsModule)],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectDeletionService,
    SqliteProjectRepository,
    {
      provide: PROJECT_REPOSITORY,
      useExisting: SqliteProjectRepository,
    },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
