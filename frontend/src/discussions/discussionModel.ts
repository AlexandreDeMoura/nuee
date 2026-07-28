import type {
  DiscussionDetails,
  DiscussionMessage,
} from '../api/discussions';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isFrozenContext(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDiscussionMessage(
  value: unknown,
  discussionId: string,
): value is DiscussionMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const message = value as Partial<DiscussionMessage>;

  return (
    isNonEmptyString(message.id) &&
    message.discussion_id === discussionId &&
    (message.role === 'user' || message.role === 'assistant') &&
    isNonEmptyString(message.content) &&
    isTimestamp(message.created_at) &&
    (message.status === 'pending' ||
      message.status === 'completed' ||
      message.status === 'failed') &&
    (message.request_id === null || isNonEmptyString(message.request_id)) &&
    (message.role === 'user' || message.status === 'completed')
  );
}

export function isDiscussionDetails(
  value: unknown,
  projectId: string,
  discussionId?: string,
): value is DiscussionDetails {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const discussion = value as Partial<DiscussionDetails>;
  const resolvedDiscussionId = discussion.id;

  if (
    !isNonEmptyString(resolvedDiscussionId) ||
    discussion.project_id !== projectId ||
    (discussionId !== undefined && resolvedDiscussionId !== discussionId) ||
    !isNonEmptyString(discussion.title) ||
    !isFrozenContext(discussion.frozen_context) ||
    !isTimestamp(discussion.created_at) ||
    !isTimestamp(discussion.updated_at) ||
    !isTimestamp(discussion.last_activity_at) ||
    !Array.isArray(discussion.messages)
  ) {
    return false;
  }

  const seenMessageIds = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;

  return discussion.messages.every((message) => {
    if (
      !isDiscussionMessage(message, resolvedDiscussionId) ||
      seenMessageIds.has(message.id)
    ) {
      return false;
    }

    const timestamp = Date.parse(message.created_at);

    if (timestamp < previousTimestamp) {
      return false;
    }

    seenMessageIds.add(message.id);
    previousTimestamp = timestamp;
    return true;
  });
}

export function assertDiscussionDetails(
  value: unknown,
  projectId: string,
  discussionId?: string,
): DiscussionDetails {
  if (!isDiscussionDetails(value, projectId, discussionId)) {
    throw new Error('The discussion response contained invalid data.');
  }

  return value;
}

/**
 * Temporary no-selection context builder. Discussion Context will replace this
 * seam with its opaque, user-confirmed snapshot package.
 */
export function buildDefaultFrozenContext(
  projectDescription: string,
): Record<string, unknown> {
  return {
    project_description: {
      content: projectDescription,
    },
  };
}
