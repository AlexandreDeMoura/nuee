import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DiscussionContextModule } from '../discussion-context/discussion-context.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  DISCUSSION_MESSAGE_REPOSITORY,
  DISCUSSION_REPOSITORY,
} from './discussion.types';
import { DiscussionsController } from './discussions.controller';
import { DiscussionsService } from './discussions.service';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

@Module({
  imports: [AiModule, ProjectsModule, DiscussionContextModule],
  controllers: [DiscussionsController],
  providers: [
    DiscussionsService,
    SqliteDiscussionRepository,
    {
      provide: DISCUSSION_REPOSITORY,
      useExisting: SqliteDiscussionRepository,
    },
    {
      provide: DISCUSSION_MESSAGE_REPOSITORY,
      useExisting: SqliteDiscussionRepository,
    },
  ],
  exports: [DiscussionsService],
})
export class DiscussionsModule {}
