import type {
  Bubble,
  Territory as SharedTerritory,
  TerritoryPositionUpdate,
} from '@nuee/shared-types';

export type {
  BatchRepositionTerritoriesInput,
  RepositionTerritoryInput,
  TerritoryPositionUpdate,
  UpdateTerritoryVisibleCountInput,
} from '@nuee/shared-types';

/**
 * Transitional persistence model for PRD 10 territory rows. Remove it with
 * the migration that converts composed territories to manual territories.
 */
export type TerritoryKind = 'composed' | 'ungrouped';

export type Territory = Omit<SharedTerritory, 'kind'> & {
  kind: TerritoryKind;
};

/** Temporary response model until the recompose endpoint is removed. */
export interface RecomposeTerritoriesResponse {
  territories: Territory[];
  bubbles: Bubble[];
}

export interface PersistedTerritoryPosition extends TerritoryPositionUpdate {
  updated_at: string;
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
  deleteComposedIfEmpty(projectId: string, territoryId: string): boolean;
  deleteComposedByIds(projectId: string, territoryIds: string[]): void;
}

export interface TerritoryBubbleLifecycle {
  ensureUngrouped(projectId: string): Territory;
  reconcileAfterBubbleDeletion(projectId: string, territoryId: string): void;
}

export const TERRITORY_REPOSITORY = Symbol('TERRITORY_REPOSITORY');
export const TERRITORY_BUBBLE_LIFECYCLE = Symbol('TERRITORY_BUBBLE_LIFECYCLE');

export const UNGROUPED_TERRITORY_TITLE = 'Ungrouped';
export const UNGROUPED_TERRITORY_KIND: TerritoryKind = 'ungrouped';
