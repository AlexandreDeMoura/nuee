import type {
  Discussion,
  DiscussionMessage,
  DiscussionMessageStatus,
  FrozenContext,
} from '@nuee/shared-types';

export type {
  Discussion,
  DiscussionMessage,
  DiscussionMessageStatus,
  DiscussionRole,
  FrozenContext,
} from '@nuee/shared-types';

export interface PersistedDiscussion extends Omit<
  Discussion,
  'title' | 'frozen_context'
> {
  title: string | null;
  frozen_context: FrozenContext;
  deleted_at: string | null;
}

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

export const DISCUSSION_REPOSITORY = Symbol('DISCUSSION_REPOSITORY');
export const DISCUSSION_MESSAGE_REPOSITORY = Symbol(
  'DISCUSSION_MESSAGE_REPOSITORY',
);
