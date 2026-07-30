import {
  isFrozenContextV1,
  type DiscussionDetails,
  type DiscussionMessage,
  type FrozenContextItem,
} from '../api';
import type { KnowledgeExtractionSourceIssue } from './knowledgeExtractionStateMachine';

export function knowledgeExtractionSourceRefKey(
  sourceKind: KnowledgeExtractionSourceIssue['sourceKind'],
  sourceId: string,
): string {
  return `${sourceKind}:${sourceId}`;
}

export function eligibleKnowledgeExtractionMessages(
  discussion: DiscussionDetails,
): DiscussionMessage[] {
  return discussion.messages.filter(
    (message) =>
      message.status === 'completed' &&
      message.content.trim().length > 0,
  );
}

export function eligibleKnowledgeExtractionContextItems(
  discussion: DiscussionDetails,
): FrozenContextItem[] {
  return isFrozenContextV1(
    discussion.frozen_context,
    discussion.project_id,
  )
    ? discussion.frozen_context.items.filter(
        (item) => item.frozen_content.trim().length > 0,
      )
    : [];
}

export function hasEligibleKnowledgeExtractionSource(
  discussion: DiscussionDetails | null,
): boolean {
  return (
    discussion !== null &&
    (eligibleKnowledgeExtractionMessages(discussion).length > 0 ||
      eligibleKnowledgeExtractionContextItems(discussion).length > 0)
  );
}
