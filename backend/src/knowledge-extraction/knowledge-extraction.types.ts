import type {
  DiscussionContextSourceKind,
  DiscussionRole,
} from '@nuee/shared-types';

export type KnowledgeExtractionMessageSelection =
  | {
      kind: 'selected';
      message_ids: string[];
    }
  | {
      kind: 'whole_discussion';
    };

export interface CreateKnowledgeExtractionSnapshotInput {
  idempotency_key: string;
  message_selection: KnowledgeExtractionMessageSelection;
  frozen_context_item_ids: string[];
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
  message_selection_kind: KnowledgeExtractionMessageSelection['kind'];
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
  proposal: Record<string, unknown> | null;
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
