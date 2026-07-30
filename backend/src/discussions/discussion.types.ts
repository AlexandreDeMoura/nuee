import type {
  Discussion,
  DiscussionContextSourceKind,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  FrozenContextV1,
  LegacyFrozenContext,
} from '@nuee/shared-types';

export type {
  Discussion,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  DiscussionFrozenContext,
  FrozenContextItem,
  FrozenContextV1,
} from '@nuee/shared-types';

export interface LegacyDiscussionContextMetadata {
  context_version: null;
  expected_context_item_count: null;
  creation_idempotency_key: null;
  creation_request_fingerprint: null;
}

export interface VersionedDiscussionContextMetadata {
  context_version: FrozenContextV1['version'];
  expected_context_item_count: number;
  creation_idempotency_key: string;
  creation_request_fingerprint: string;
}

export type DiscussionContextMetadata =
  LegacyDiscussionContextMetadata | VersionedDiscussionContextMetadata;

interface PersistedDiscussionBase extends Omit<
  Discussion,
  'title' | 'frozen_context'
> {
  title: string | null;
  deleted_at: string | null;
}

export type LegacyPersistedDiscussion = PersistedDiscussionBase &
  LegacyDiscussionContextMetadata & {
    frozen_context: LegacyFrozenContext;
  };

export type VersionedPersistedDiscussion = PersistedDiscussionBase &
  VersionedDiscussionContextMetadata & {
    frozen_context: FrozenContextV1;
  };

export type PersistedDiscussion =
  LegacyPersistedDiscussion | VersionedPersistedDiscussion;

export type PersistedDiscussionMessage = DiscussionMessage;

export interface DiscussionRepository {
  createWithFirstMessage(
    discussion: PersistedDiscussion,
    message: PersistedDiscussionMessage,
  ): PersistedDiscussion;
  findAllByProjectId(projectId: string): PersistedDiscussion[];
  findByProjectAndId(
    projectId: string,
    discussionId: string,
  ): PersistedDiscussion | undefined;
  findByProjectAndCreationIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): PersistedDiscussion | undefined;
  updateTitle(
    projectId: string,
    discussionId: string,
    title: string,
    updatedAt: string,
  ): PersistedDiscussion | undefined;
  updateActivity(
    projectId: string,
    discussionId: string,
    lastActivityAt: string,
  ): PersistedDiscussion | undefined;
  softDelete(
    projectId: string,
    discussionId: string,
    deletedAt: string,
  ): boolean;
}

export interface DiscussionMessageRepository {
  appendMessage(
    projectId: string,
    message: PersistedDiscussionMessage,
    activityAt: string,
  ): PersistedDiscussionMessage | undefined;
  findAllMessages(
    projectId: string,
    discussionId: string,
  ): PersistedDiscussionMessage[];
  findMessageByRequestId(
    projectId: string,
    discussionId: string,
    requestId: string,
  ): PersistedDiscussionMessage | undefined;
  completeMessageGeneration(
    projectId: string,
    discussionId: string,
    userMessageId: string,
    assistantMessage: PersistedDiscussionMessage,
    completedAt: string,
  ): PersistedDiscussionMessage | undefined;
  updateMessageStatus(
    projectId: string,
    discussionId: string,
    messageId: string,
    status: DiscussionMessageStatus,
    updatedAt: string,
  ): PersistedDiscussionMessage | undefined;
}

export type DiscussionExtractionMessageSelection =
  | {
      kind: 'selected';
      message_ids: string[];
    }
  | {
      kind: 'whole_discussion';
    };

export interface DiscussionExtractionSourceSelection {
  message_selection: DiscussionExtractionMessageSelection;
  frozen_context_item_ids: string[];
}

export interface DiscussionExtractionMessageSource {
  id: string;
  role: DiscussionRole;
  content: string;
  created_at: string;
}

export interface DiscussionExtractionFrozenContextSource {
  id: string;
  source_kind: DiscussionContextSourceKind;
  source_title: string;
  frozen_content: string;
  created_at: string;
  display_order: number;
}

export type DiscussionExtractionSourceIssueReason =
  'missing' | 'cross_project' | 'cross_discussion' | 'inaccessible';

export interface DiscussionExtractionSourceIssue {
  source_kind: 'message' | 'frozen_context';
  source_id: string;
  reason: DiscussionExtractionSourceIssueReason;
}

export type DiscussionExtractionSourceReadResult =
  | {
      status: 'discussion_not_found';
    }
  | {
      status: 'invalid_sources';
      issues: DiscussionExtractionSourceIssue[];
    }
  | {
      status: 'available';
      discussion_title: string;
      messages: DiscussionExtractionMessageSource[];
      frozen_context_items: DiscussionExtractionFrozenContextSource[];
    };

export interface DiscussionExtractionSourceReader {
  readExtractionSources(
    projectId: string,
    discussionId: string,
    selection: DiscussionExtractionSourceSelection,
  ): DiscussionExtractionSourceReadResult;
}

export const DISCUSSION_REPOSITORY = Symbol('DISCUSSION_REPOSITORY');
export const DISCUSSION_MESSAGE_REPOSITORY = Symbol(
  'DISCUSSION_MESSAGE_REPOSITORY',
);
export const DISCUSSION_EXTRACTION_SOURCE_READER = Symbol(
  'DISCUSSION_EXTRACTION_SOURCE_READER',
);

export class DiscussionContextIntegrityError extends Error {
  readonly code = 'DISCUSSION_CONTEXT_CORRUPT';

  constructor(readonly discussionId: string) {
    super(
      `The persisted context for discussion "${discussionId}" is incomplete or corrupt.`,
    );
    this.name = 'DiscussionContextIntegrityError';
  }
}
