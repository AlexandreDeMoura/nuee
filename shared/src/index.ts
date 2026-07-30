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
  source_discussion_title: string | null;
  source_discussion_deleted_at: string | null;
  source_message_ids: string[];
  source_context_item_ids: string[];
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

export type DiscussionRole = 'user' | 'assistant';
export type DiscussionMessageStatus = 'pending' | 'completed' | 'failed';

/**
 * The live source kind captured by an immutable discussion-context item.
 */
export type DiscussionContextSourceKind =
  | 'project_description'
  | 'bubble'
  | 'document';

interface FrozenContextItemBase {
  id: string;
  source_id: string;
  source_title: string;
  frozen_content: string;
  created_at: string;
  display_order: number;
}

export interface FrozenProjectDescriptionContextItem
  extends FrozenContextItemBase {
  source_kind: 'project_description';
}

export interface FrozenBubbleContextItem extends FrozenContextItemBase {
  source_kind: 'bubble';
}

export interface FrozenDocumentContextItem extends FrozenContextItemBase {
  source_kind: 'document';
}

export type FrozenContextItem =
  | FrozenProjectDescriptionContextItem
  | FrozenBubbleContextItem
  | FrozenDocumentContextItem;

/**
 * A complete immutable context package assembled when a discussion starts.
 * Item order is authoritative and remains stable for the discussion lifetime.
 */
export interface FrozenContextV1 {
  version: 1;
  items: FrozenContextItem[];
}

export type FrozenContext = FrozenContextV1;

/**
 * Historical discussions stored an opaque JSON object before context packages
 * were versioned. Consumers may read this variant but must not reinterpret it
 * as a versioned package.
 */
export type LegacyFrozenContext = Record<string, unknown>;

export type DiscussionFrozenContext = FrozenContext | LegacyFrozenContext;

/**
 * Ordered live-source identifiers selected before discussion creation.
 * Array order is preserved when the frozen context package is assembled.
 */
export interface DiscussionContextSelectionInput {
  bubble_ids: string[];
  document_ids: string[];
}

export interface Discussion {
  id: string;
  project_id: string;
  title: string;
  frozen_context: DiscussionFrozenContext;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface DiscussionMessage {
  id: string;
  discussion_id: string;
  role: DiscussionRole;
  content: string;
  created_at: string;
  status: DiscussionMessageStatus;
  request_id: string | null;
}

export interface CreateDiscussionInput
  extends DiscussionContextSelectionInput {
  project_id: string;
  first_prompt: string;
  idempotency_key: string;
}

export interface SendMessageInput {
  content: string;
  idempotency_key: string;
}

export type KnowledgeExtractionMessageSelection =
  | {
      kind: 'selected';
      message_ids: string[];
    }
  | {
      kind: 'whole_discussion';
    };

export interface CreateKnowledgeExtractionInput {
  idempotency_key: string;
  message_selection: KnowledgeExtractionMessageSelection;
  frozen_context_item_ids: string[];
}

export interface KnowledgeExtractionProposal {
  title: string;
  summary: string;
  content: string;
}

export interface KnowledgeExtractionSourceReference {
  message_selection_kind: KnowledgeExtractionMessageSelection['kind'];
  message_ids: string[];
  frozen_context_item_ids: string[];
}

export interface KnowledgeExtractionProposalResponse {
  id: string;
  project_id: string;
  discussion_id: string;
  status: 'ready';
  proposal: KnowledgeExtractionProposal;
  source: KnowledgeExtractionSourceReference;
  created_at: string;
  expires_at: string;
}

export type ResolveKnowledgeExtractionInput =
  | {
      kind: 'new_bubble';
      proposal: KnowledgeExtractionProposal;
    }
  | {
      kind: 'reject';
    };

export type KnowledgeExtractionResolutionResponse = {
  id: string;
  project_id: string;
  discussion_id: string;
  status: 'resolved';
  resolution:
    | {
        kind: 'new_bubble';
        bubble: Bubble;
      }
    | {
        kind: 'reject';
      };
};

export type DiscussionSummary = Omit<Discussion, 'frozen_context'> & {
  is_active: boolean;
};

export interface DiscussionDetails extends Discussion {
  messages: DiscussionMessage[];
}

export type DiscussionListResponse = DiscussionSummary[];
