import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import {
  BUBBLE_CONTEXT_SOURCE_READER,
  BUBBLE_LINK_REPOSITORY,
  BUBBLE_REPOSITORY,
} from './bubble.types';
import { BubblePlacementService } from './bubble-placement.service';
import { BubbleLinksController } from './bubble-links.controller';
import { BubbleLinksService } from './bubble-links.service';
import { BubblesController } from './bubbles.controller';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [BubblesController, BubbleLinksController],
  providers: [
    BubblesService,
    BubblePlacementService,
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
    BubbleLinksService,
  ],
  exports: [
    BubblesService,
    BubblePlacementService,
    BubbleLinksService,
    BUBBLE_CONTEXT_SOURCE_READER,
  ],
})
export class BubblesModule {}
