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
