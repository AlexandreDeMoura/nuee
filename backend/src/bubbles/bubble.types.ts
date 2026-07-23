export type BubbleSourceKind = 'manual' | 'discussion';

export interface Bubble {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  content: string;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
  source_kind: BubbleSourceKind;
  source_discussion_id: string | null;
  source_message_ids: string[];
}

export interface CreateBubbleInput {
  title: string;
  summary?: string | null;
  content: string;
  position_x?: number;
  position_y?: number;
}

export interface UpdateBubbleInput {
  title?: string;
  summary?: string | null;
  content?: string;
}

export interface RepositionBubbleInput {
  position_x: number;
  position_y: number;
}

export type BubblePlacementStrategy = 'viewport' | 'cluster';

export interface PlaceBubbleInput {
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

export interface BubbleLink {
  id: string;
  project_id: string;
  bubble_a_id: string;
  bubble_b_id: string;
  created_at: string;
}

export interface CreateBubbleLinkInput {
  bubble_a_id: string;
  bubble_b_id: string;
}

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
