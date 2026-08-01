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

/**
 * The durable server-side lifecycle for an accepted document.
 * Upload transfer progress is client-local and is intentionally not persisted.
 */
export type DocumentProcessingStatus = 'processing' | 'ready' | 'failed';

export type DocumentFormatCategory = 'plain_text' | 'markdown' | 'pdf';

/**
 * Safe, stable failure categories exposed to clients. Internal parser,
 * scanner, storage, and provider details must not cross the API boundary.
 */
export type DocumentProcessingErrorCode =
  | 'unsafe'
  | 'encrypted'
  | 'corrupted'
  | 'no_text'
  | 'too_complex'
  | 'storage_unavailable'
  | 'scanner_unavailable'
  | 'processing_unavailable'
  | 'unknown';

interface DocumentSummaryBase {
  id: string;
  project_id: string;
  title: string;
  original_filename: string;
  format: DocumentFormatCategory;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

interface ProcessingDocumentSummary extends DocumentSummaryBase {
  processing_status: 'processing';
  processing_error_code: null;
  can_retry: false;
}

interface ReadyDocumentSummary extends DocumentSummaryBase {
  processing_status: 'ready';
  processing_error_code: null;
  can_retry: false;
}

interface FailedDocumentSummary extends DocumentSummaryBase {
  processing_status: 'failed';
  processing_error_code: DocumentProcessingErrorCode;
  can_retry: boolean;
}

/**
 * Metadata returned by project-scoped document lists. Extracted text is
 * deliberately absent so listing a project does not expose document bodies.
 */
export type DocumentSummary =
  | ProcessingDocumentSummary
  | ReadyDocumentSummary
  | FailedDocumentSummary;

/**
 * Project-scoped inspection result. Only a ready document may expose the
 * complete processed representation used for discussion context.
 */
export type DocumentDetail =
  | (ProcessingDocumentSummary & {
      extracted_text: null;
    })
  | (ReadyDocumentSummary & {
      extracted_text: string;
    })
  | (FailedDocumentSummary & {
      extracted_text: null;
    });

export type DocumentListResponse = DocumentSummary[];

export interface DocumentUploadFormatPolicy {
  category: DocumentFormatCategory;
  extensions: string[];
  mime_types: string[];
}

/**
 * Backend-authoritative limits and formats used for client upload preflight.
 * The server must enforce the same policy independently.
 */
export interface DocumentUploadPolicy {
  supported_formats: DocumentUploadFormatPolicy[];
  max_file_size_bytes: number;
  max_files_per_request: number;
  max_documents_per_project: number;
  max_project_storage_bytes: number;
}

export type DocumentUploadPolicyResponse = DocumentUploadPolicy;
export type UploadDocumentResponse = DocumentSummary;
export type RetryDocumentProcessingResponse = DocumentSummary;

export type DiscussionRole = 'user' | 'assistant';
export type DiscussionMessageStatus = 'pending' | 'completed' | 'failed';

/**
 * A provider-neutral web source attributed to an assistant message.
 * Citations describe outbound sources only and never contain fetched content.
 */
export interface MessageCitation {
  url: string;
  title: string;
  snippet?: string;
}

/**
 * AI features available to clients under the configured provider and
 * application policy.
 */
export interface AiCapabilities {
  web_search: boolean;
}

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
  web_search_used?: boolean;
  citations?: MessageCitation[];
}

export interface CreateDiscussionInput
  extends DiscussionContextSelectionInput {
  project_id: string;
  first_prompt: string;
  idempotency_key: string;
  web_search?: boolean;
}

export interface SendMessageInput {
  content: string;
  idempotency_key: string;
  web_search?: boolean;
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
      kind: 'update_bubble';
      proposal: KnowledgeExtractionProposal;
      target_bubble_id: string;
      expected_updated_at: string;
    }
  | {
      kind: 'reject';
    };

export type KnowledgeExtractionTargetPreview = Pick<
  Bubble,
  'id' | 'title' | 'summary' | 'content' | 'updated_at'
>;

export interface KnowledgeExtractionTargetChangedError {
  code: 'KNOWLEDGE_EXTRACTION_TARGET_CHANGED';
  message: string;
  current_target: KnowledgeExtractionTargetPreview;
}

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
        kind: 'update_bubble';
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
