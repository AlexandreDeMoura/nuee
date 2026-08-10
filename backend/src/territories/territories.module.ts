import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { SqliteTerritoryRepository } from './sqlite-territory.repository';
import { TerritoriesController } from './territories.controller';
import { TerritoriesService } from './territories.service';
import {
  TERRITORY_BUBBLE_LIFECYCLE,
  TERRITORY_REPOSITORY,
} from './territory.types';

@Module({
  imports: [ProjectsModule],
  controllers: [TerritoriesController],
  providers: [
    TerritoriesService,
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
