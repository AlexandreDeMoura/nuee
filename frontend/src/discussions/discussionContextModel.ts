import {
  isFrozenContextV1,
  type DiscussionDetails,
  type FrozenContextItem,
} from '../api';

export type DiscussionContextKind =
  | 'project_description'
  | 'bubble'
  | 'document';

export interface DiscussionContextBadge {
  id: string;
  kind: DiscussionContextKind;
  label: string;
  item: FrozenContextItem;
}

export interface DiscussionContextInspection {
  discussionId: string;
  item: FrozenContextItem;
}

export type DiscussionContextBadgeResolver = (
  discussion: DiscussionDetails,
) => readonly DiscussionContextBadge[];

export function getDiscussionContextBadges(
  discussion: DiscussionDetails,
): readonly DiscussionContextBadge[] {
  if (
    !isFrozenContextV1(
      discussion.frozen_context,
      discussion.project_id,
    )
  ) {
    return [];
  }

  return discussion.frozen_context.items.map((item) => ({
    id: item.id,
    item,
    kind: item.source_kind,
    label:
      item.source_kind === 'project_description'
        ? 'Project context'
        : item.source_title,
  }));
}

/**
 * Stable public name retained for callers of the former project-only adapter.
 * It now projects every persisted versioned context item.
 */
export const defaultDiscussionContextBadges: DiscussionContextBadgeResolver =
  getDiscussionContextBadges;

export function findFrozenContextItem(
  discussion: DiscussionDetails | null,
  contextId: string | null,
): FrozenContextItem | null {
  if (
    !discussion ||
    !contextId ||
    !isFrozenContextV1(
      discussion.frozen_context,
      discussion.project_id,
    )
  ) {
    return null;
  }

  return (
    discussion.frozen_context.items.find((item) => item.id === contextId) ??
    null
  );
}
