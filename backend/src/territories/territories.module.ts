import { forwardRef, Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BubblesModule } from '../bubbles/bubbles.module';
import { ProjectsModule } from '../projects/projects.module';
import { SqliteTerritoryRepository } from './sqlite-territory.repository';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';
import { TerritoryRecompositionService } from './territory-recomposition.service';
import { TerritoryDeletionService } from './territory-deletion.service';
import {
  TERRITORY_BUBBLE_LIFECYCLE,
  TERRITORY_REPOSITORY,
} from './territory.types';

@Module({
  imports: [AiModule, ProjectsModule, forwardRef(() => BubblesModule)],
  controllers: [TerritoriesController],
  providers: [
    TerritoriesService,
    TerritoryDeletionService,
    TerritoryRecompositionService,
    SqliteTerritoryRepository,
    {
      provide: TERRITORY_REPOSITORY,
      useExisting: SqliteTerritoryRepository,
    },
    {
      provide: TERRITORY_BUBBLE_LIFECYCLE,
      useExisting: TerritoriesService,
    },
  ],
  exports: [TerritoriesService, TERRITORY_BUBBLE_LIFECYCLE],
})
export class TerritoriesModule {}
