export interface Project {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

export interface CreateProjectInput {
  title: string;
  description: string;
}

export interface UpdateProjectDescriptionInput {
  description: string;
}

export interface UpdateProjectViewportInput {
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

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

export interface BubblePositionUpdate extends RepositionBubbleInput {
  bubble_id: string;
}

export interface BatchRepositionBubblesInput {
  positions: BubblePositionUpdate[];
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
