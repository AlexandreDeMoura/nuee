import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { TerritoriesModule } from '../territories/territories.module';
import {
  BUBBLE_CONTEXT_SOURCE_READER,
  BUBBLE_DISCUSSION_PROVENANCE_WRITER,
  BUBBLE_EXTRACTION_WRITER,
  BUBBLE_LINK_REPOSITORY,
  BUBBLE_REPOSITORY,
  BUBBLE_TERRITORY_ASSIGNMENT_WRITER,
} from './bubble.types';
import { BubbleLinksController } from './bubble-links.controller';
import { BubbleLinksService } from './bubble-links.service';
import { BubblesController } from './bubbles.controller';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

@Module({
  imports: [ProjectsModule, TerritoriesModule],
  controllers: [BubblesController, BubbleLinksController],
  providers: [
    BubblesService,
    SqliteBubbleRepository,
    {
      provide: BUBBLE_REPOSITORY,
      useExisting: SqliteBubbleRepository,
    },
    {
      provide: BUBBLE_LINK_REPOSITORY,
      useExisting: SqliteBubbleRepository,
    },
    {
      provide: BUBBLE_CONTEXT_SOURCE_READER,
      useExisting: BubblesService,
    },
    {
      provide: BUBBLE_EXTRACTION_WRITER,
      useExisting: BubblesService,
    },
    {
      provide: BUBBLE_TERRITORY_ASSIGNMENT_WRITER,
      useExisting: BubblesService,
    },
    {
      provide: BUBBLE_DISCUSSION_PROVENANCE_WRITER,
      useExisting: SqliteBubbleRepository,
    },
    BubbleLinksService,
  ],
  exports: [
    BubblesService,
    BubbleLinksService,
    BUBBLE_CONTEXT_SOURCE_READER,
    BUBBLE_EXTRACTION_WRITER,
    BUBBLE_TERRITORY_ASSIGNMENT_WRITER,
    BUBBLE_DISCUSSION_PROVENANCE_WRITER,
  ],
})
export class BubblesModule {}
