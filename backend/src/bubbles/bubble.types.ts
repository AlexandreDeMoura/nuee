import type { Bubble, BubbleLink } from '@nuee/shared-types';

export type {
  Bubble,
  BubbleLink,
  BubbleSourceKind,
  CreateBubbleInput,
  CreateBubbleLinkInput,
  UpdateBubbleInput,
} from '@nuee/shared-types';

export interface PersistedBubble extends Bubble {
  latest_extraction_id: string | null;
}

export interface BubbleRepository {
  create(bubble: PersistedBubble): Bubble;
  findAllByProjectId(projectId: string): Bubble[];
  findProjectIdById(id: string): string | undefined;
  findByProjectAndId(projectId: string, id: string): Bubble | undefined;
  findByLatestExtractionId(extractionId: string): Bubble | undefined;
  updateContent(
    projectId: string,
    id: string,
    input: Pick<Bubble, 'title' | 'summary' | 'content' | 'updated_at'>,
  ): Bubble | undefined;
  updateFromDiscussionExtraction(
    projectId: string,
    id: string,
    expectedUpdatedAt: string,
    bubble: Pick<
      PersistedBubble,
      | 'title'
      | 'summary'
      | 'content'
      | 'updated_at'
      | 'source_kind'
      | 'source_discussion_id'
      | 'source_discussion_title'
      | 'source_discussion_deleted_at'
      | 'source_message_ids'
      | 'source_context_item_ids'
      | 'latest_extraction_id'
    >,
  ): Bubble | undefined;
  updateTerritories(
    projectId: string,
    assignments: BubbleTerritoryAssignment[],
  ): Bubble[];
  moveTerritoryMembers(
    projectId: string,
    sourceTerritoryId: string,
    destinationTerritoryId: string,
  ): number;
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

export type BubbleContextSource = Pick<
  Bubble,
  'id' | 'project_id' | 'title' | 'content'
>;

export type BubbleContextSourceReadResult =
  | {
      status: 'available';
      source: BubbleContextSource;
    }
  | {
      status: 'unavailable';
      reason: 'missing' | 'inaccessible' | 'cross_project';
    };

export interface BubbleContextSourceReader {
  readContextSource(
    projectId: string,
    bubbleId: string,
  ): BubbleContextSourceReadResult;
}

export interface DiscussionExtractionBubbleProvenance {
  extraction_id: string;
  source_discussion_id: string;
  source_discussion_title: string;
  source_message_ids: string[];
  source_context_item_ids: string[];
}

export interface CreateBubbleFromDiscussionExtractionInput extends DiscussionExtractionBubbleProvenance {
  project_id: string;
  title: string;
  summary: string | null;
  content: string;
}

export interface UpdateBubbleFromDiscussionExtractionInput extends CreateBubbleFromDiscussionExtractionInput {
  bubble_id: string;
  expected_updated_at: string;
}

export type CreateBubbleFromDiscussionExtractionResult =
  | { status: 'created'; bubble: Bubble }
  | { status: 'replayed'; bubble: Bubble }
  | { status: 'extraction_conflict'; bubble: Bubble };

export type UpdateBubbleFromDiscussionExtractionResult =
  | { status: 'updated'; bubble: Bubble }
  | { status: 'replayed'; bubble: Bubble }
  | { status: 'extraction_conflict'; bubble: Bubble }
  | { status: 'target_changed'; bubble: Bubble }
  | { status: 'target_missing' };

export interface BubbleExtractionWriter {
  findByDiscussionExtraction(
    projectId: string,
    extractionId: string,
  ): Bubble | undefined;
  createFromDiscussionExtraction(
    input: CreateBubbleFromDiscussionExtractionInput,
  ): CreateBubbleFromDiscussionExtractionResult;
  updateFromDiscussionExtraction(
    input: UpdateBubbleFromDiscussionExtractionInput,
  ): UpdateBubbleFromDiscussionExtractionResult;
}

export interface BubbleTerritoryAssignment {
  bubble_id: string;
  territory_id: string;
}

export interface BubbleTerritoryAssignmentWriter {
  assignTerritories(
    projectId: string,
    assignments: BubbleTerritoryAssignment[],
  ): Bubble[];
  moveTerritoryMembers(
    projectId: string,
    sourceTerritoryId: string,
    destinationTerritoryId: string,
  ): number;
}

export interface BubbleTerritoryCompositionReader {
  listForTerritoryComposition(projectId: string): Bubble[];
}

export interface BubbleDiscussionProvenanceWriter {
  markSourceDiscussionDeleted(
    projectId: string,
    discussionId: string,
    deletedAt: string,
  ): number;
}

export class BubbleProvenanceIntegrityError extends Error {
  constructor(bubbleId: string) {
    super(`Stored provenance for bubble "${bubbleId}" is invalid.`);
    this.name = 'BubbleProvenanceIntegrityError';
  }
}

export const BUBBLE_REPOSITORY = Symbol('BUBBLE_REPOSITORY');
export const BUBBLE_LINK_REPOSITORY = Symbol('BUBBLE_LINK_REPOSITORY');
export const BUBBLE_CONTEXT_SOURCE_READER = Symbol(
  'BUBBLE_CONTEXT_SOURCE_READER',
);
export const BUBBLE_EXTRACTION_WRITER = Symbol('BUBBLE_EXTRACTION_WRITER');
export const BUBBLE_TERRITORY_ASSIGNMENT_WRITER = Symbol(
  'BUBBLE_TERRITORY_ASSIGNMENT_WRITER',
);
export const BUBBLE_TERRITORY_COMPOSITION_READER = Symbol(
  'BUBBLE_TERRITORY_COMPOSITION_READER',
);
export const BUBBLE_DISCUSSION_PROVENANCE_WRITER = Symbol(
  'BUBBLE_DISCUSSION_PROVENANCE_WRITER',
);
