import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { ProjectsModule } from '../projects/projects.module';
import { BUBBLE_REPOSITORY } from './bubble.types';
import { BubblesController } from './bubbles.controller';
import { BubblesService } from './bubbles.service';
import { SqliteBubbleRepository } from './sqlite-bubble.repository';

@Module({
  imports: [ProjectsModule],
  controllers: [BubblesController],
  providers: [
    BubblesService,
    {
      provide: BUBBLE_REPOSITORY,
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
  ],
  exports: [BubblesService],
})
export class BubblesModule {}
