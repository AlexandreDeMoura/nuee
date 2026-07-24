import type {
  Bubble,
  BubbleLink,
  BubblePositionUpdate,
} from '@nuee/shared-types';

export type {
  BatchRepositionBubblesInput,
  Bubble,
  BubbleLink,
  BubblePlacement,
  BubblePlacementStrategy,
  BubblePositionUpdate,
  BubbleSourceKind,
  CreateBubbleInput,
  CreateBubbleLinkInput,
  PlaceBubbleInput,
  RepositionBubbleInput,
  UpdateBubbleInput,
} from '@nuee/shared-types';

export interface BubbleRepository {
  create(bubble: Bubble): Bubble;
  findAllByProjectId(projectId: string): Bubble[];
  findByProjectAndId(projectId: string, id: string): Bubble | undefined;
  updateContent(
    projectId: string,
    id: string,
    input: Pick<Bubble, 'title' | 'summary' | 'content' | 'updated_at'>,
  ): Bubble | undefined;
  updatePosition(
    projectId: string,
    id: string,
    positionX: number,
    positionY: number,
  ): Bubble | undefined;
  updatePositions(
    projectId: string,
    positions: BubblePositionUpdate[],
  ): Bubble[];
  delete(projectId: string, id: string): boolean;
}

export interface BubbleLinkRepository {
  createLink(link: BubbleLink): BubbleLink;
  findAllLinksByProjectId(projectId: string): BubbleLink[];
  findLink(
    projectId: string,
    bubbleAId: string,
    bubbleBId: string,
  ): BubbleLink | undefined;
  deleteLink(projectId: string, bubbleAId: string, bubbleBId: string): boolean;
}

export const BUBBLE_REPOSITORY = Symbol('BUBBLE_REPOSITORY');
export const BUBBLE_LINK_REPOSITORY = Symbol('BUBBLE_LINK_REPOSITORY');
