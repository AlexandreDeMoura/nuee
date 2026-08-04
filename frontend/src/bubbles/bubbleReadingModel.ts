import type { Bubble } from '../api';

/** Absolute day-level date, for metadata that should not read as "recently". */
export function formatBubbleDate(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function extractionSourceDetails(bubble: Bubble): string {
  const details = [
    bubble.source_discussion_title
      ? `Discussion: ${bubble.source_discussion_title}`
      : 'Discussion extraction',
  ];
  const messageCount = bubble.source_message_ids.length;
  const contextCount = bubble.source_context_item_ids.length;

  if (bubble.source_discussion_deleted_at) {
    details.push('Source discussion deleted');
  }

  if (messageCount > 0) {
    details.push(
      `${messageCount} source ${messageCount === 1 ? 'message' : 'messages'}`,
    );
  }

  if (contextCount > 0) {
    details.push(
      `${contextCount} frozen context ${contextCount === 1 ? 'item' : 'items'}`,
    );
  }

  return details.join(' · ');
}
