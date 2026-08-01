import type {
  DiscussionContextSelectionInput,
  DiscussionDetails,
  DiscussionMessage,
  FrozenContextItem,
  FrozenContextV1,
  MessageCitation,
} from '@nuee/shared-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isSupportedSourceKind(
  value: unknown,
): value is FrozenContextItem['source_kind'] {
  return (
    value === 'project_description' ||
    value === 'bubble' ||
    value === 'document'
  );
}

function isFrozenContextItem(
  value: unknown,
  expectedDisplayOrder: number,
): value is FrozenContextItem {
  if (!isRecord(value) || !isSupportedSourceKind(value.source_kind)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.source_id) &&
    isNonEmptyString(value.source_title) &&
    typeof value.frozen_content === 'string' &&
    (value.source_kind === 'project_description' ||
      value.frozen_content.trim().length > 0) &&
    isTimestamp(value.created_at) &&
    Number.isInteger(value.display_order) &&
    value.display_order === expectedDisplayOrder
  );
}

function deduplicate(sourceIds: readonly string[]): string[] {
  return [...new Set(sourceIds)];
}

function matchesExpectedSelection(
  items: readonly FrozenContextItem[],
  selection: DiscussionContextSelectionInput,
): boolean {
  const expectedSources = [
    ...deduplicate(selection.bubble_ids).map((sourceId) => ({
      sourceId,
      sourceKind: 'bubble' as const,
    })),
    ...deduplicate(selection.document_ids).map((sourceId) => ({
      sourceId,
      sourceKind: 'document' as const,
    })),
  ];

  return (
    items.length === expectedSources.length + 1 &&
    expectedSources.every((expected, index) => {
      const item = items[index + 1];

      return (
        item?.source_kind === expected.sourceKind &&
        item.source_id === expected.sourceId
      );
    })
  );
}

export function isFrozenContextV1(
  value: unknown,
  projectId: string,
  expectedSelection?: DiscussionContextSelectionInput,
): value is FrozenContextV1 {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) {
    return false;
  }

  const items = value.items;

  if (items.length === 0) {
    return false;
  }

  const itemIds = new Set<string>();
  const sourceIdentifiers = new Set<string>();
  const displayOrders = new Set<number>();
  let projectDescriptionCount = 0;

  for (const [index, itemValue] of items.entries()) {
    if (!isFrozenContextItem(itemValue, index)) {
      return false;
    }

    const item = itemValue;
    const sourceIdentifier = `${item.source_kind}:${item.source_id}`;

    if (
      itemIds.has(item.id) ||
      sourceIdentifiers.has(sourceIdentifier) ||
      displayOrders.has(item.display_order)
    ) {
      return false;
    }

    if (item.source_kind === 'project_description') {
      projectDescriptionCount += 1;

      if (index !== 0 || item.source_id !== projectId) {
        return false;
      }
    }

    itemIds.add(item.id);
    sourceIdentifiers.add(sourceIdentifier);
    displayOrders.add(item.display_order);
  }

  if (
    projectDescriptionCount !== 1 ||
    displayOrders.size !== items.length ||
    !items.every((_, index) => displayOrders.has(index))
  ) {
    return false;
  }

  return (
    expectedSelection === undefined ||
    matchesExpectedSelection(items, expectedSelection)
  );
}

function isDiscussionFrozenContext(
  value: unknown,
  projectId: string,
  expectedSelection?: DiscussionContextSelectionInput,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  if ('version' in value || 'items' in value || expectedSelection) {
    return isFrozenContextV1(value, projectId, expectedSelection);
  }

  return true;
}

function isDiscussionMessage(
  value: unknown,
  discussionId: string,
): value is DiscussionMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    value.discussion_id === discussionId &&
    (value.role === 'user' || value.role === 'assistant') &&
    isNonEmptyString(value.content) &&
    isTimestamp(value.created_at) &&
    (value.status === 'pending' ||
      value.status === 'completed' ||
      value.status === 'failed') &&
    (value.request_id === null || isNonEmptyString(value.request_id)) &&
    (value.role === 'user' || value.status === 'completed') &&
    (value.web_search_used === undefined ||
      typeof value.web_search_used === 'boolean') &&
    (value.citations === undefined ||
      (Array.isArray(value.citations) &&
        value.citations.every(isMessageCitation)))
  );
}

function isMessageCitation(value: unknown): value is MessageCitation {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    typeof value.title === 'string' &&
    (value.snippet === undefined || typeof value.snippet === 'string')
  );
}

export function isDiscussionDetails(
  value: unknown,
  projectId: string,
  discussionId?: string,
  expectedSelection?: DiscussionContextSelectionInput,
): value is DiscussionDetails {
  if (!isRecord(value)) {
    return false;
  }

  const resolvedDiscussionId = value.id;

  if (
    !isNonEmptyString(resolvedDiscussionId) ||
    value.project_id !== projectId ||
    (discussionId !== undefined && resolvedDiscussionId !== discussionId) ||
    !isNonEmptyString(value.title) ||
    !isDiscussionFrozenContext(
      value.frozen_context,
      projectId,
      expectedSelection,
    ) ||
    !isTimestamp(value.created_at) ||
    !isTimestamp(value.updated_at) ||
    !isTimestamp(value.last_activity_at) ||
    !Array.isArray(value.messages)
  ) {
    return false;
  }

  const seenMessageIds = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;

  return value.messages.every((message) => {
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
  expectedSelection?: DiscussionContextSelectionInput,
): DiscussionDetails {
  if (
    !isDiscussionDetails(
      value,
      projectId,
      discussionId,
      expectedSelection,
    )
  ) {
    throw new Error('The discussion response contained invalid data.');
  }

  return value;
}
