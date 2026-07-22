import type { Bubble } from '../api';

const PREVIEW_MAX_LENGTH = 180;

function normalizePreviewText(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function truncatePreview(value: string) {
  if (value.length <= PREVIEW_MAX_LENGTH) {
    return value;
  }

  const candidate = value.slice(0, PREVIEW_MAX_LENGTH + 1);
  const lastWordBoundary = candidate.lastIndexOf(' ');
  const end =
    lastWordBoundary >= PREVIEW_MAX_LENGTH * 0.6
      ? lastWordBoundary
      : PREVIEW_MAX_LENGTH;

  return `${candidate.slice(0, end).trimEnd()}…`;
}

function contentOpeningSentence(content: string) {
  const normalizedContent = normalizePreviewText(content);
  const sentenceEnd = normalizedContent.search(/[.!?](?=\s|$)/);

  return sentenceEnd === -1
    ? normalizedContent
    : normalizedContent.slice(0, sentenceEnd + 1);
}

export function getBubbleCardPreview(
  bubble: Pick<Bubble, 'content' | 'summary'>,
) {
  const summary = bubble.summary ? normalizePreviewText(bubble.summary) : '';
  const preview = summary || contentOpeningSentence(bubble.content);

  return truncatePreview(preview);
}
