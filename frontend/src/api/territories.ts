import {
  TERRITORY_TITLE_MAX_LENGTH,
  TERRITORY_VISIBLE_COUNT_MAX,
  TERRITORY_VISIBLE_COUNT_MIN,
  type BatchRepositionTerritoriesInput,
  type BatchRepositionTerritoriesResponse,
  type RepositionTerritoryInput,
  type RepositionTerritoryResponse,
  type RecomposeTerritoriesInput,
  type RecomposeTerritoriesResponse,
  type Territory,
  type TerritoryKind,
  type TerritoryListResponse,
  type TerritoryPositionUpdate,
  type UpdateTerritoryVisibleCountInput,
  type UpdateTerritoryVisibleCountResponse,
} from '@nuee/shared-types';
import { isBubbleResponse } from './bubbles';
import { requestJson } from './client';

export type {
  BatchRepositionTerritoriesInput,
  BatchRepositionTerritoriesResponse,
  RepositionTerritoryInput,
  RepositionTerritoryResponse,
  RecomposeTerritoriesInput,
  RecomposeTerritoriesResponse,
  Territory,
  TerritoryKind,
  TerritoryListResponse,
  TerritoryPositionUpdate,
  UpdateTerritoryVisibleCountInput,
  UpdateTerritoryVisibleCountResponse,
};

export type TerritoriesRequest = typeof requestJson;
export type TerritoryRecomposeRequest = (
  projectId: string,
  input?: RecomposeTerritoriesInput,
) => Promise<RecomposeTerritoriesResponse>;

const INVALID_TERRITORIES_MESSAGE =
  'The territory list response contained invalid data.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function isTerritoryResponse(
  value: unknown,
  projectId: string,
): value is Territory {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyIdentifier(value.id) &&
    value.project_id === projectId &&
    (value.kind === 'composed' || value.kind === 'ungrouped') &&
    typeof value.title === 'string' &&
    value.title.trim().length > 0 &&
    value.title.trim().length <= TERRITORY_TITLE_MAX_LENGTH &&
    typeof value.position_x === 'number' &&
    Number.isFinite(value.position_x) &&
    typeof value.position_y === 'number' &&
    Number.isFinite(value.position_y) &&
    typeof value.visible_count === 'number' &&
    Number.isInteger(value.visible_count) &&
    value.visible_count >= TERRITORY_VISIBLE_COUNT_MIN &&
    value.visible_count <= TERRITORY_VISIBLE_COUNT_MAX &&
    isIsoTimestamp(value.created_at) &&
    isIsoTimestamp(value.updated_at)
  );
}

export function assertTerritoryListResponse(
  value: unknown,
  projectId: string,
): TerritoryListResponse {
  if (
    !Array.isArray(value) ||
    !value.every((territory) => isTerritoryResponse(territory, projectId)) ||
    new Set(value.map((territory) => territory.id)).size !== value.length ||
    value.filter((territory) => territory.kind === 'ungrouped').length > 1
  ) {
    throw new Error(INVALID_TERRITORIES_MESSAGE);
  }

  return value;
}

export function assertRecomposeTerritoriesResponse(
  value: unknown,
  projectId: string,
): RecomposeTerritoriesResponse {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('territories' in value) ||
    !('bubbles' in value)
  ) {
    throw new Error(INVALID_TERRITORIES_MESSAGE);
  }

  const territories = assertTerritoryListResponse(
    value.territories,
    projectId,
  );
  const territoryIds = new Set(territories.map(({ id }) => id));

  if (
    !Array.isArray(value.bubbles) ||
    !value.bubbles.every(
      (bubble) =>
        isBubbleResponse(bubble, projectId) &&
        territoryIds.has(bubble.territory_id),
    ) ||
    new Set(value.bubbles.map((bubble) => bubble.id)).size !==
      value.bubbles.length
  ) {
    throw new Error(INVALID_TERRITORIES_MESSAGE);
  }

  return { territories, bubbles: value.bubbles };
}

export function createTerritoriesApi(
  request: TerritoriesRequest = requestJson,
) {
  function getProjectTerritories(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<TerritoryListResponse> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/territories`,
      { signal },
    ).then((response) => assertTerritoryListResponse(response, projectId));
  }

  function repositionTerritory(
    projectId: string,
    territoryId: string,
    input: RepositionTerritoryInput,
  ): Promise<RepositionTerritoryResponse> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/territories/${encodeURIComponent(territoryId)}/position`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => {
      if (
        !isTerritoryResponse(response, projectId) ||
        response.id !== territoryId
      ) {
        throw new Error(INVALID_TERRITORIES_MESSAGE);
      }

      return response;
    });
  }

  function updateTerritoryVisibleCount(
    projectId: string,
    territoryId: string,
    input: UpdateTerritoryVisibleCountInput,
  ): Promise<UpdateTerritoryVisibleCountResponse> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/territories/${encodeURIComponent(territoryId)}/visible-count`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => {
      if (
        !isTerritoryResponse(response, projectId) ||
        response.id !== territoryId
      ) {
        throw new Error(INVALID_TERRITORIES_MESSAGE);
      }

      return response;
    });
  }

  function repositionTerritories(
    projectId: string,
    input: BatchRepositionTerritoriesInput,
  ): Promise<BatchRepositionTerritoriesResponse> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/territories/positions`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => {
      const territories = assertTerritoryListResponse(response, projectId);
      const expectedIds = new Set(
        input.positions.map(({ territory_id }) => territory_id),
      );

      if (
        expectedIds.size !== input.positions.length ||
        territories.length !== expectedIds.size ||
        territories.some((territory) => !expectedIds.has(territory.id))
      ) {
        throw new Error(INVALID_TERRITORIES_MESSAGE);
      }

      return territories;
    });
  }

  function recomposeTerritories(
    projectId: string,
    input: RecomposeTerritoriesInput = {},
  ): Promise<RecomposeTerritoriesResponse> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/territories/recompose`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) =>
      assertRecomposeTerritoriesResponse(response, projectId),
    );
  }

  return {
    getProjectTerritories,
    repositionTerritories,
    repositionTerritory,
    recomposeTerritories,
    updateTerritoryVisibleCount,
  };
}

export const {
  getProjectTerritories,
  repositionTerritories,
  repositionTerritory,
  recomposeTerritories,
  updateTerritoryVisibleCount,
} = createTerritoriesApi();
