import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { RecomposeTerritoriesResponse } from '@nuee/shared-types';
import type {
  BatchRepositionTerritoriesInput,
  RepositionTerritoryInput,
  Territory,
  UpdateTerritoryVisibleCountInput,
} from './territory.types';
import { TerritoriesService } from './territories.service';
import { TerritoryRecompositionService } from './territory-recomposition.service';

@Controller('projects/:projectId/territories')
export class TerritoriesController {
  constructor(
    private readonly territories: TerritoriesService,
    private readonly recomposition: TerritoryRecompositionService,
  ) {}

  @Get()
  list(@Param('projectId') projectId: string): Territory[] {
    return this.territories.list(projectId);
  }

  @Post('recompose')
  recompose(
    @Param('projectId') projectId: string,
    @Body() input: unknown,
  ): Promise<RecomposeTerritoriesResponse> {
    return this.recomposition.recompose(projectId, input);
  }

  @Patch('positions')
  repositionMany(
    @Param('projectId') projectId: string,
    @Body() input: BatchRepositionTerritoriesInput,
  ): Territory[] {
    return this.territories.repositionMany(projectId, input);
  }

  @Patch(':territoryId/visible-count')
  updateVisibleCount(
    @Param('projectId') projectId: string,
    @Param('territoryId') territoryId: string,
    @Body() input: UpdateTerritoryVisibleCountInput,
  ): Territory {
    return this.territories.updateVisibleCount(projectId, territoryId, input);
  }

  @Patch(':territoryId/position')
  reposition(
    @Param('projectId') projectId: string,
    @Param('territoryId') territoryId: string,
    @Body() input: RepositionTerritoryInput,
  ): Territory {
    return this.territories.reposition(projectId, territoryId, input);
  }
}
