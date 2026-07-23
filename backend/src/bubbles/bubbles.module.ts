import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { ProjectsModule } from '../projects/projects.module';
import { BUBBLE_LINK_REPOSITORY, BUBBLE_REPOSITORY } from './bubble.types';
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
    {
      provide: SqliteBubbleRepository,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SqliteBubbleRepository => {
        const defaultDatabasePath = join(
          __dirname,
          '..',
          '..',
          'data',
          'nuee.sqlite',
        );

        return new SqliteBubbleRepository(
          config.get<string>('PROJECT_DATABASE_PATH') ?? defaultDatabasePath,
        );
      },
    },
    {
      provide: BUBBLE_REPOSITORY,
      useExisting: SqliteBubbleRepository,
    },
    {
      provide: BUBBLE_LINK_REPOSITORY,
      useExisting: SqliteBubbleRepository,
    },
    BubbleLinksService,
  ],
  exports: [BubblesService, BubblePlacementService, BubbleLinksService],
})
export class BubblesModule {}
