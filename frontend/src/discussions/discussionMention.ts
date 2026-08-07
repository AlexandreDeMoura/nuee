export interface DiscussionMentionQuery {
  query: string;
  triggerIndex: number;
}

export function isDiscussionMentionSourceAttachable(
  source: DiscussionSourceCatalogItem,
): boolean {
  return source.kind === 'bubble' || source.readiness.status === 'ready';
}

export function discussionMentionSourceKey(
  source: DiscussionSourceCatalogItem,
): string {
  return `${source.kind}:${source.id}`;
}

/**
 * Finds the mention being typed immediately before the caret. Mentions start at
 * the beginning of the draft or after a non-word character; line breaks and a
 * second @ end the active query.
 */
export function findDiscussionMentionQuery(
  value: string,
  caretPosition: number | null,
): DiscussionMentionQuery | null {
  if (caretPosition === null) {
    return null;
  }

  const caret = Math.max(0, Math.min(caretPosition, value.length));
  const triggerIndex = value.lastIndexOf('@', caret - 1);

  if (triggerIndex < 0) {
    return null;
  }

  const precedingCharacter = value[triggerIndex - 1];
  if (triggerIndex > 0 && /[\p{L}\p{N}_]/u.test(precedingCharacter)) {
    return null;
  }

  const query = value.slice(triggerIndex + 1, caret);
  if (query.includes('@') || /[\r\n]/u.test(query)) {
    return null;
  }

  return { query, triggerIndex };
}
import type { DiscussionSourceCatalogItem } from './discussionSourceCatalog';
