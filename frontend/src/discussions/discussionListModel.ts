import type {
  DiscussionDetails,
  DiscussionListResponse,
  DiscussionSummary,
} from '../api';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isDiscussionSummary(
  value: unknown,
  projectId: string,
): value is DiscussionSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const discussion = value as Partial<DiscussionSummary>;

  return (
    isNonEmptyString(discussion.id) &&
    discussion.project_id === projectId &&
    isNonEmptyString(discussion.title) &&
    isTimestamp(discussion.created_at) &&
    isTimestamp(discussion.updated_at) &&
    isTimestamp(discussion.last_activity_at) &&
    typeof discussion.is_active === 'boolean'
  );
}

function newestFirst(
  first: DiscussionSummary,
  second: DiscussionSummary,
): number {
  const activityDifference =
    Date.parse(second.last_activity_at) - Date.parse(first.last_activity_at);

  if (activityDifference !== 0) {
    return activityDifference;
  }

  const creationDifference =
    Date.parse(second.created_at) - Date.parse(first.created_at);

  if (creationDifference !== 0) {
    return creationDifference;
  }

  return second.id.localeCompare(first.id);
}

/**
 * The latest qualifying activity is the single source of truth for both list
 * position and Active state. Server flags are validated at the boundary, then
 * normalized so an out-of-order payload cannot render several Active rows.
 */
export function normalizeDiscussionList(
  value: unknown,
  projectId: string,
): DiscussionListResponse {
  if (!Array.isArray(value)) {
    throw new Error('The discussion list response contained invalid data.');
  }

  const seenIds = new Set<string>();

  for (const discussion of value) {
    if (
      !isDiscussionSummary(discussion, projectId) ||
      seenIds.has(discussion.id)
    ) {
      throw new Error('The discussion list response contained invalid data.');
    }

    seenIds.add(discussion.id);
  }

  return [...value]
    .sort(newestFirst)
    .map((discussion, index) => ({
      ...discussion,
      is_active: index === 0,
    }));
}

export function discussionSummaryFromDetails(
  discussion: DiscussionDetails,
): DiscussionSummary {
  return {
    id: discussion.id,
    project_id: discussion.project_id,
    title: discussion.title,
    created_at: discussion.created_at,
    updated_at: discussion.updated_at,
    last_activity_at: discussion.last_activity_at,
    is_active: true,
  };
}

export function mergeDiscussionLists(
  projectId: string,
  ...lists: ReadonlyArray<ReadonlyArray<DiscussionSummary>>
): DiscussionListResponse {
  const byId = new Map<string, DiscussionSummary>();

  for (const list of lists) {
    for (const discussion of list) {
      const current = byId.get(discussion.id);

      if (
        !current ||
        Date.parse(discussion.updated_at) >= Date.parse(current.updated_at)
      ) {
        byId.set(discussion.id, discussion);
      }
    }
  }

  return normalizeDiscussionList([...byId.values()], projectId);
}
