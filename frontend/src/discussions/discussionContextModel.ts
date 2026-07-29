import { isFrozenContextV1, type DiscussionDetails } from '../api';

export type DiscussionContextKind =
  | 'project_description'
  | 'bubble'
  | 'document';

export interface DiscussionContextBadge {
  id: string;
  kind: DiscussionContextKind;
  label: string;
}

export interface DiscussionContextInspection {
  contextId: string;
  discussionId: string;
}

export type DiscussionContextBadgeResolver = (
  discussion: DiscussionDetails,
) => readonly DiscussionContextBadge[];

/**
 * Temporary adapter for the no-additional-context flow. Discussion Context
 * owns richer badge metadata and can replace this through the resolver seam.
 */
export const defaultDiscussionContextBadges: DiscussionContextBadgeResolver = (
  discussion,
) => {
  if (
    isFrozenContextV1(
      discussion.frozen_context,
      discussion.project_id,
    )
  ) {
    const projectContext = discussion.frozen_context.items[0];

    return [
      {
        id: projectContext.id,
        kind: 'project_description',
        label: 'Project context',
      },
    ];
  }

  return Object.prototype.hasOwnProperty.call(
    discussion.frozen_context,
    'project_description',
  )
    ? [
        {
          id: 'project_description',
          kind: 'project_description',
          label: 'Project context',
        },
      ]
    : [];
};
