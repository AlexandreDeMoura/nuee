import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BubblesModule } from '../bubbles/bubbles.module';
import { DiscussionContextModule } from '../discussion-context/discussion-context.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  DISCUSSION_EXTRACTION_SOURCE_READER,
  DISCUSSION_MESSAGE_REPOSITORY,
  DISCUSSION_REPOSITORY,
} from './discussion.types';
import { DiscussionsController } from './discussions.controller';
import { DiscussionsService } from './discussions.service';
import { SqliteDiscussionRepository } from './sqlite-discussion.repository';

@Module({
  imports: [AiModule, ProjectsModule, BubblesModule, DiscussionContextModule],
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
    {
      provide: DISCUSSION_EXTRACTION_SOURCE_READER,
      useExisting: SqliteDiscussionRepository,
    },
  ],
  exports: [DiscussionsService, DISCUSSION_EXTRACTION_SOURCE_READER],
})
export class DiscussionsModule {}
