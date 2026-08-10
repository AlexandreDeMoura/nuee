import type {
  Bubble as SharedBubble,
  BubbleLink,
  BubbleSourceKind,
  CreateBubbleInput as SharedCreateBubbleInput,
  CreateBubbleLinkInput,
  UpdateBubbleInput as SharedUpdateBubbleInput,
} from '@nuee/shared-types';
import { requestJson } from './client';

export type {
  BubbleLink,
  BubbleSourceKind,
  CreateBubbleLinkInput,
};

/**
 * Transitional frontend model for the bubble-canvas slices that still consume
 * the pre-territory API. Remove it when the territory collection replaces the
 * free-positioned bubble collection.
 */
export type Bubble = Omit<SharedBubble, 'territory_id'> & {
  position_x: number;
  position_y: number;
};

export type CreateBubbleInput = SharedCreateBubbleInput & {
  position_x: number;
  position_y: number;
};
export interface UpdateBubblePositionInput {
  position_x: number;
  position_y: number;
}
export interface BubblePositionUpdate extends UpdateBubblePositionInput {
  bubble_id: string;
}
export interface BatchUpdateBubblePositionsInput {
  positions: BubblePositionUpdate[];
}
export type UpdateBubbleInput = Required<SharedUpdateBubbleInput>;
export type BubblePlacementStrategy = 'viewport' | 'cluster';
export interface BubblePlacementInput {
  strategy: BubblePlacementStrategy;
  viewport_x?: number;
  viewport_y?: number;
  viewport_width?: number;
  viewport_height?: number;
}
export interface BubblePlacement {
  position_x: number;
  position_y: number;
}
export type BubblesRequest = typeof requestJson;

const INVALID_BUBBLE_MESSAGE =
  'The bubble response contained invalid data.';
const INVALID_BUBBLES_MESSAGE =
  'The bubble list response contained invalid data.';
const INVALID_PLACEMENT_MESSAGE =
  'The bubble placement response contained invalid data.';
const INVALID_LINK_MESSAGE =
  'The bubble link response contained invalid data.';
const INVALID_LINKS_MESSAGE =
  'The bubble link list response contained invalid data.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIdentifierList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(isNonEmptyIdentifier) &&
    new Set(value).size === value.length
  );
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

export function isBubbleResponse(
  value: unknown,
  projectId: string,
  bubbleId?: string,
): value is Bubble {
  if (!isRecord(value)) {
    return false;
  }

  const bubble = value as Partial<Bubble>;
  const sourceMessageIds = bubble.source_message_ids;
  const sourceContextItemIds = bubble.source_context_item_ids;
  const hasCommonFields =
    isNonEmptyIdentifier(bubble.id) &&
    (bubbleId === undefined || bubble.id === bubbleId) &&
    bubble.project_id === projectId &&
    isNonEmptyIdentifier(bubble.title) &&
    (bubble.summary === null || typeof bubble.summary === 'string') &&
    isNonEmptyIdentifier(bubble.content) &&
    typeof bubble.position_x === 'number' &&
    Number.isFinite(bubble.position_x) &&
    typeof bubble.position_y === 'number' &&
    Number.isFinite(bubble.position_y) &&
    isIsoTimestamp(bubble.created_at) &&
    isIsoTimestamp(bubble.updated_at) &&
    isIdentifierList(sourceMessageIds) &&
    isIdentifierList(sourceContextItemIds);

  if (!hasCommonFields) {
    return false;
  }

  if (bubble.source_kind === 'manual') {
    return (
      bubble.source_discussion_id === null &&
      bubble.source_discussion_title === null &&
      bubble.source_discussion_deleted_at === null &&
      sourceMessageIds.length === 0 &&
      sourceContextItemIds.length === 0
    );
  }

  return (
    bubble.source_kind === 'discussion' &&
    isNonEmptyIdentifier(bubble.source_discussion_id) &&
    isNonEmptyIdentifier(bubble.source_discussion_title) &&
    (bubble.source_discussion_deleted_at === null ||
      isIsoTimestamp(bubble.source_discussion_deleted_at)) &&
    sourceMessageIds.length + sourceContextItemIds.length > 0
  );
}

export function assertBubbleResponse(
  value: unknown,
  projectId: string,
  bubbleId?: string,
): Bubble {
  if (!isBubbleResponse(value, projectId, bubbleId)) {
    throw new Error(INVALID_BUBBLE_MESSAGE);
  }

  return value;
}

export function isBubbleListResponse(
  value: unknown,
  projectId: string,
): value is Bubble[] {
  return (
    Array.isArray(value) &&
    value.every((bubble) => isBubbleResponse(bubble, projectId)) &&
    new Set(value.map((bubble) => bubble.id)).size === value.length
  );
}

export function assertBubbleListResponse(
  value: unknown,
  projectId: string,
): Bubble[] {
  if (!isBubbleListResponse(value, projectId)) {
    throw new Error(INVALID_BUBBLES_MESSAGE);
  }

  return value;
}

export function isBubblePlacementResponse(
  value: unknown,
): value is BubblePlacement {
  return (
    isRecord(value) &&
    typeof value.position_x === 'number' &&
    Number.isFinite(value.position_x) &&
    typeof value.position_y === 'number' &&
    Number.isFinite(value.position_y)
  );
}

export function assertBubblePlacementResponse(
  value: unknown,
): BubblePlacement {
  if (!isBubblePlacementResponse(value)) {
    throw new Error(INVALID_PLACEMENT_MESSAGE);
  }

  return value;
}

function orderedLinkPair(
  firstBubbleId: string,
  secondBubbleId: string,
): readonly [string, string] {
  return firstBubbleId < secondBubbleId
    ? [firstBubbleId, secondBubbleId]
    : [secondBubbleId, firstBubbleId];
}

function bubbleLinkPairKey(link: BubbleLink): string {
  return JSON.stringify([link.bubble_a_id, link.bubble_b_id]);
}

export function isBubbleLinkResponse(
  value: unknown,
  projectId: string,
  expectedBubbleIds?: readonly [string, string],
): value is BubbleLink {
  if (!isRecord(value)) {
    return false;
  }

  const hasValidFields =
    isNonEmptyIdentifier(value.id) &&
    value.project_id === projectId &&
    isNonEmptyIdentifier(value.bubble_a_id) &&
    isNonEmptyIdentifier(value.bubble_b_id) &&
    value.bubble_a_id < value.bubble_b_id &&
    isIsoTimestamp(value.created_at);

  if (!hasValidFields || expectedBubbleIds === undefined) {
    return hasValidFields;
  }

  const expectedPair = orderedLinkPair(...expectedBubbleIds);

  return (
    value.bubble_a_id === expectedPair[0] &&
    value.bubble_b_id === expectedPair[1]
  );
}

export function assertBubbleLinkResponse(
  value: unknown,
  projectId: string,
  expectedBubbleIds?: readonly [string, string],
): BubbleLink {
  if (!isBubbleLinkResponse(value, projectId, expectedBubbleIds)) {
    throw new Error(INVALID_LINK_MESSAGE);
  }

  return value;
}

export function isBubbleLinkListResponse(
  value: unknown,
  projectId: string,
): value is BubbleLink[] {
  if (
    !Array.isArray(value) ||
    !value.every((link) => isBubbleLinkResponse(link, projectId))
  ) {
    return false;
  }

  return (
    new Set(value.map((link) => link.id)).size === value.length &&
    new Set(value.map(bubbleLinkPairKey)).size === value.length
  );
}

export function assertBubbleLinkListResponse(
  value: unknown,
  projectId: string,
): BubbleLink[] {
  if (!isBubbleLinkListResponse(value, projectId)) {
    throw new Error(INVALID_LINKS_MESSAGE);
  }

  return value;
}

export function createBubblesApi(request: BubblesRequest = requestJson) {
  function getProjectBubbles(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<Bubble[]> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles`,
      { signal },
    ).then((response) => assertBubbleListResponse(response, projectId));
  }

  function getBubblePlacement(
    projectId: string,
    input: BubblePlacementInput,
  ): Promise<BubblePlacement> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles/placement`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then(assertBubblePlacementResponse);
  }

  function createBubble(
    projectId: string,
    input: CreateBubbleInput,
  ): Promise<Bubble> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => assertBubbleResponse(response, projectId));
  }

  function updateBubblePosition(
    projectId: string,
    bubbleId: string,
    input: UpdateBubblePositionInput,
  ): Promise<Bubble> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}/position`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) =>
      assertBubbleResponse(response, projectId, bubbleId),
    );
  }

  function updateBubblePositions(
    projectId: string,
    input: BatchUpdateBubblePositionsInput,
  ): Promise<Bubble[]> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles/positions`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) => assertBubbleListResponse(response, projectId));
  }

  function updateBubble(
    projectId: string,
    bubbleId: string,
    input: UpdateBubbleInput,
    signal?: AbortSignal,
  ): Promise<Bubble> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    ).then((response) =>
      assertBubbleResponse(response, projectId, bubbleId),
    );
  }

  function deleteBubble(
    projectId: string,
    bubbleId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return request<void>(
      `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
      {
        method: 'DELETE',
        signal,
      },
    );
  }

  function getBubbleLinks(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<BubbleLink[]> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubble-links`,
      { signal },
    ).then((response) => assertBubbleLinkListResponse(response, projectId));
  }

  function createBubbleLink(
    projectId: string,
    input: CreateBubbleLinkInput,
  ): Promise<BubbleLink> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/bubble-links`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    ).then((response) =>
      assertBubbleLinkResponse(response, projectId, [
        input.bubble_a_id,
        input.bubble_b_id,
      ]),
    );
  }

  function deleteBubbleLink(
    projectId: string,
    firstBubbleId: string,
    secondBubbleId: string,
  ): Promise<void> {
    return request<void>(
      `/projects/${encodeURIComponent(projectId)}/bubble-links/${encodeURIComponent(firstBubbleId)}/${encodeURIComponent(secondBubbleId)}`,
      { method: 'DELETE' },
    );
  }

  return {
    createBubble,
    createBubbleLink,
    deleteBubble,
    deleteBubbleLink,
    getBubbleLinks,
    getBubblePlacement,
    getProjectBubbles,
    updateBubble,
    updateBubblePosition,
    updateBubblePositions,
  };
}

export const {
  createBubble,
  createBubbleLink,
  deleteBubble,
  deleteBubbleLink,
  getBubbleLinks,
  getBubblePlacement,
  getProjectBubbles,
  updateBubble,
  updateBubblePosition,
  updateBubblePositions,
} = createBubblesApi();
