import type {
  BatchRepositionBubblesInput,
  Bubble,
  BubbleLink,
  BubblePlacement,
  BubblePlacementStrategy,
  BubblePositionUpdate,
  BubbleSourceKind,
  CreateBubbleInput as SharedCreateBubbleInput,
  CreateBubbleLinkInput,
  PlaceBubbleInput,
  RepositionBubbleInput,
  UpdateBubbleInput as SharedUpdateBubbleInput,
} from '@nuee/shared-types';
import { requestJson } from './client';

export type {
  Bubble,
  BubbleLink,
  BubblePlacement,
  BubblePlacementStrategy,
  BubblePositionUpdate,
  BubbleSourceKind,
  CreateBubbleLinkInput,
};

type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type CreateBubbleInput = WithRequired<
  SharedCreateBubbleInput,
  'position_x' | 'position_y'
>;
export type UpdateBubblePositionInput = RepositionBubbleInput;
export type BatchUpdateBubblePositionsInput = BatchRepositionBubblesInput;
export type UpdateBubbleInput = Required<SharedUpdateBubbleInput>;
export type BubblePlacementInput = PlaceBubbleInput;

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
): value is Bubble {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const bubble = value as Partial<Bubble>;
  const sourceMessageIds = bubble.source_message_ids;
  const sourceContextItemIds = bubble.source_context_item_ids;
  const hasCommonFields =
    isNonEmptyIdentifier(bubble.id) &&
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

export function getProjectBubbles(
  projectId: string,
  signal?: AbortSignal,
): Promise<Bubble[]> {
  return requestJson<Bubble[]>(
    `/projects/${encodeURIComponent(projectId)}/bubbles`,
    { signal },
  );
}

export function getBubblePlacement(
  projectId: string,
  input: BubblePlacementInput,
): Promise<BubblePlacement> {
  return requestJson<BubblePlacement>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/placement`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function createBubble(
  projectId: string,
  input: CreateBubbleInput,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubblePosition(
  projectId: string,
  bubbleId: string,
  input: UpdateBubblePositionInput,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}/position`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubblePositions(
  projectId: string,
  input: BatchUpdateBubblePositionsInput,
): Promise<Bubble[]> {
  return requestJson<Bubble[]>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/positions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubble(
  projectId: string,
  bubbleId: string,
  input: UpdateBubbleInput,
  signal?: AbortSignal,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    },
  );
}

export function deleteBubble(
  projectId: string,
  bubbleId: string,
  signal?: AbortSignal,
): Promise<void> {
  return requestJson<void>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
    {
      method: 'DELETE',
      signal,
    },
  );
}

export function getBubbleLinks(
  projectId: string,
  signal?: AbortSignal,
): Promise<BubbleLink[]> {
  return requestJson<BubbleLink[]>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links`,
    { signal },
  );
}

export function createBubbleLink(
  projectId: string,
  input: CreateBubbleLinkInput,
): Promise<BubbleLink> {
  return requestJson<BubbleLink>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function deleteBubbleLink(
  projectId: string,
  firstBubbleId: string,
  secondBubbleId: string,
): Promise<void> {
  return requestJson<void>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links/${encodeURIComponent(firstBubbleId)}/${encodeURIComponent(secondBubbleId)}`,
    { method: 'DELETE' },
  );
}
