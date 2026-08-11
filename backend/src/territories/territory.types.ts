import type {
  Bubble,
  Territory,
  TerritoryPositionUpdate,
} from '@nuee/shared-types';

export type {
  BatchRepositionTerritoriesInput,
  CreateTerritoryInput,
  DeleteTerritoryResponse,
  RenameTerritoryInput,
  RepositionTerritoryInput,
  Territory,
  TerritoryKind,
  TerritoryPositionUpdate,
  UpdateTerritoryVisibleCountInput,
} from '@nuee/shared-types';

export interface PersistedTerritoryPosition extends TerritoryPositionUpdate {
  updated_at: string;
}

/** Temporary response model until the recompose endpoint is removed. */
export interface RecomposeTerritoriesResponse {
  territories: Territory[];
  bubbles: Bubble[];
}

export interface TerritoryRepository {
  create(territory: Territory): Territory;
  findAllByProjectId(projectId: string): Territory[];
  findByProjectAndId(
    projectId: string,
    territoryId: string,
  ): Territory | undefined;
  findUngroupedByProjectId(projectId: string): Territory | undefined;
  countBubbles(projectId: string, territoryId: string): number;
  updateVisibleCount(
    projectId: string,
    territoryId: string,
    visibleCount: number,
    updatedAt: string,
  ): Territory | undefined;
  updatePosition(
    projectId: string,
    territoryId: string,
    positionX: number,
    positionY: number,
    updatedAt: string,
  ): Territory | undefined;
  updatePositions(
    projectId: string,
    positions: PersistedTerritoryPosition[],
  ): Territory[];
  updateTitle(
    projectId: string,
    territoryId: string,
    title: string,
    updatedAt: string,
  ): Territory | undefined;
  delete(projectId: string, territoryId: string): boolean;
  deleteManualByIds(projectId: string, territoryIds: string[]): void;
}

export interface TerritoryBubbleLifecycle {
  ensureUngrouped(projectId: string): Territory;
  reconcileAfterBubbleDeletion(projectId: string, territoryId: string): void;
}

export const TERRITORY_REPOSITORY = Symbol('TERRITORY_REPOSITORY');
export const TERRITORY_BUBBLE_LIFECYCLE = Symbol('TERRITORY_BUBBLE_LIFECYCLE');

export const UNGROUPED_TERRITORY_TITLE = 'Ungrouped';
export const UNGROUPED_TERRITORY_KIND = 'ungrouped' as const;
