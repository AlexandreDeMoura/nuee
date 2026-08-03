import type {
  DiscussionContextSourceKind,
  DiscussionRole,
  KnowledgeExtractionDetailLevel,
  KnowledgeExtractionProposal,
} from '@nuee/shared-types';

export const KNOWLEDGE_EXTRACTION_INSTRUCTIONS_MAX_LENGTH = 2_000;

export interface CreateKnowledgeExtractionSnapshotInput {
  idempotency_key: string;
  message_ids: string[];
  frozen_context_item_ids: string[];
  instructions: string | null;
  detail_level: KnowledgeExtractionDetailLevel;
}

export interface KnowledgeExtractionMessageSnapshot {
  source_kind: 'message';
  source_id: string;
  role: DiscussionRole;
  content: string;
  created_at: string;
  discussion_order: number;
}

export interface KnowledgeExtractionFrozenContextSnapshot {
  source_kind: 'frozen_context';
  source_id: string;
  context_source_kind: DiscussionContextSourceKind;
  source_title: string;
  content: string;
  created_at: string;
  display_order: number;
}

export interface KnowledgeExtractionSourceSnapshotV1 {
  version: 1;
  project_id: string;
  discussion_id: string;
  discussion_title: string;
  requested_at: string;
  /** Legacy snapshots may retain the removed whole-discussion marker. */
  message_selection_kind: 'selected' | 'whole_discussion';
  messages: KnowledgeExtractionMessageSnapshot[];
  frozen_context_items: KnowledgeExtractionFrozenContextSnapshot[];
}

export type KnowledgeExtractionAttemptStatus =
  'generating' | 'ready' | 'failed' | 'resolved' | 'discarded';

export type KnowledgeExtractionResolutionKind =
  'new_bubble' | 'update_bubble' | 'reject';

export interface KnowledgeExtractionAttempt {
  id: string;
  project_id: string;
  discussion_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  source_snapshot: KnowledgeExtractionSourceSnapshotV1;
  instructions: string | null;
  detail_level: KnowledgeExtractionDetailLevel;
  proposal: KnowledgeExtractionProposal | null;
  status: KnowledgeExtractionAttemptStatus;
  resolution_fingerprint: string | null;
  resolution_kind: KnowledgeExtractionResolutionKind | null;
  resulting_bubble_id: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface KnowledgeExtractionRepository {
  create(attempt: KnowledgeExtractionAttempt): KnowledgeExtractionAttempt;
  findByProjectDiscussionAndId(
    projectId: string,
    discussionId: string,
    extractionId: string,
  ): KnowledgeExtractionAttempt | undefined;
  findByProjectDiscussionAndIdempotencyKey(
    projectId: string,
    discussionId: string,
    idempotencyKey: string,
  ): KnowledgeExtractionAttempt | undefined;
  markGeneratingForRetry(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined;
  saveProposal(
    projectId: string,
    discussionId: string,
    extractionId: string,
    proposal: KnowledgeExtractionProposal,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined;
  markGenerationFailed(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined;
  markResolved(
    projectId: string,
    discussionId: string,
    extractionId: string,
    resolution: {
      fingerprint: string;
      kind: KnowledgeExtractionResolutionKind;
      resulting_bubble_id: string | null;
      updated_at: string;
    },
  ): KnowledgeExtractionAttempt | undefined;
  markDiscarded(
    projectId: string,
    discussionId: string,
    extractionId: string,
    updatedAt: string,
  ): KnowledgeExtractionAttempt | undefined;
}

export class KnowledgeExtractionIntegrityError extends Error {
  readonly code = 'KNOWLEDGE_EXTRACTION_CORRUPT';

  constructor(extractionId: string) {
    super(
      `The persisted knowledge extraction "${extractionId}" is incomplete or corrupt.`,
    );
    this.name = 'KnowledgeExtractionIntegrityError';
  }
}

export const KNOWLEDGE_EXTRACTION_REPOSITORY = Symbol(
  'KNOWLEDGE_EXTRACTION_REPOSITORY',
);
