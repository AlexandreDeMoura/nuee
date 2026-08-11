import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  BatchRepositionTerritoriesInput,
  CreateTerritoryInput,
  DeleteTerritoryResponse,
  RecomposeTerritoriesResponse,
  RenameTerritoryInput,
  RepositionTerritoryInput,
  Territory,
  UpdateTerritoryVisibleCountInput,
} from './territory.types';
import { TerritoriesService } from './territories.service';
import { TerritoryDeletionService } from './territory-deletion.service';
import { TerritoryRecompositionService } from './territory-recomposition.service';

@Controller('projects/:projectId/territories')
export class TerritoriesController {
  constructor(
    private readonly territories: TerritoriesService,
    private readonly recomposition: TerritoryRecompositionService,
    private readonly territoryDeletion: TerritoryDeletionService,
  ) {}

  @Get()
  list(@Param('projectId') projectId: string): Territory[] {
    return this.territories.list(projectId);
  }

  @Post()
  create(
    @Param('projectId') projectId: string,
    @Body() input: CreateTerritoryInput,
  ): Territory {
    return this.territories.create(projectId, input);
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

  @Patch(':territoryId')
  rename(
    @Param('projectId') projectId: string,
    @Param('territoryId') territoryId: string,
    @Body() input: RenameTerritoryInput,
  ): Territory {
    return this.territories.rename(projectId, territoryId, input);
  }

  @Delete(':territoryId')
  delete(
    @Param('projectId') projectId: string,
    @Param('territoryId') territoryId: string,
  ): DeleteTerritoryResponse {
    return this.territoryDeletion.delete(projectId, territoryId);
  }
}
