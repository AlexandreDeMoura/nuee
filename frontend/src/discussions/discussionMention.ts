import type { DiscussionSourceCatalogItem } from './discussionSourceCatalog';

export interface DiscussionMentionQuery {
  query: string;
  triggerIndex: number;
}

export interface DiscussionMentionToken {
  end: number;
  source: DiscussionSourceCatalogItem;
  start: number;
}

export interface DiscussionMentionDraft {
  tokens: readonly DiscussionMentionToken[];
  value: string;
}

export interface DiscussionMentionAttachmentResult {
  attached: boolean;
  caretPosition: number;
  draft: DiscussionMentionDraft;
}

export interface DiscussionMentionAtomicDeletion {
  caretPosition: number;
  draft: DiscussionMentionDraft;
  removedToken: DiscussionMentionToken;
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

export function createDiscussionMentionDraft(
  value: string,
): DiscussionMentionDraft {
  return { tokens: [], value };
}

/**
 * Applies a controlled textarea change to the tracked token ranges. The
 * browser reports only the resulting string, so the edit is recovered from
 * the common prefix and suffix. An edit intersecting a token turns its
 * remaining text back into ordinary draft text and detaches the source.
 */
export function updateDiscussionMentionDraft(
  draft: DiscussionMentionDraft,
  nextValue: string,
): DiscussionMentionDraft {
  if (draft.value === nextValue) {
    return draft;
  }

  const sharedLimit = Math.min(draft.value.length, nextValue.length);
  let changeStart = 0;
  while (
    changeStart < sharedLimit &&
    draft.value[changeStart] === nextValue[changeStart]
  ) {
    changeStart += 1;
  }

  let previousSuffixStart = draft.value.length;
  let nextSuffixStart = nextValue.length;
  while (
    previousSuffixStart > changeStart &&
    nextSuffixStart > changeStart &&
    draft.value[previousSuffixStart - 1] === nextValue[nextSuffixStart - 1]
  ) {
    previousSuffixStart -= 1;
    nextSuffixStart -= 1;
  }

  const delta =
    nextSuffixStart - changeStart - (previousSuffixStart - changeStart);
  const tokens = draft.tokens.flatMap((token) => {
    if (token.end <= changeStart) {
      return [token];
    }

    if (token.start >= previousSuffixStart) {
      return [{
        ...token,
        end: token.end + delta,
        start: token.start + delta,
      }];
    }

    return [];
  });

  return { tokens, value: nextValue };
}

export function attachDiscussionMentionSource(
  draft: DiscussionMentionDraft,
  source: DiscussionSourceCatalogItem,
  mention: DiscussionMentionQuery,
): DiscussionMentionAttachmentResult {
  const sourceKey = discussionMentionSourceKey(source);
  const queryEnd = mention.triggerIndex + mention.query.length + 1;

  if (
    !isDiscussionMentionSourceAttachable(source) ||
    draft.tokens.some(
      (token) => discussionMentionSourceKey(token.source) === sourceKey,
    ) ||
    mention.triggerIndex < 0 ||
    queryEnd > draft.value.length
  ) {
    return {
      attached: false,
      caretPosition: Math.min(queryEnd, draft.value.length),
      draft,
    };
  }

  const suffix = draft.value.slice(queryEnd);
  const trailingSpace = suffix.length === 0 || !/^\s/u.test(suffix) ? ' ' : '';
  const nextValue = `${draft.value.slice(0, mention.triggerIndex)}${source.title}${trailingSpace}${suffix}`;
  const shiftedDraft = updateDiscussionMentionDraft(draft, nextValue);
  const token: DiscussionMentionToken = {
    end: mention.triggerIndex + source.title.length,
    source,
    start: mention.triggerIndex,
  };

  return {
    attached: true,
    caretPosition: token.end + trailingSpace.length,
    draft: {
      tokens: [...shiftedDraft.tokens, token],
      value: nextValue,
    },
  };
}

export function removeDiscussionMentionToken(
  draft: DiscussionMentionDraft,
  source: DiscussionSourceCatalogItem,
): DiscussionMentionDraft {
  const sourceKey = discussionMentionSourceKey(source);
  const token = draft.tokens.find(
    (candidate) =>
      discussionMentionSourceKey(candidate.source) === sourceKey,
  );

  if (!token) {
    return draft;
  }

  return updateDiscussionMentionDraft(
    draft,
    `${draft.value.slice(0, token.start)}${draft.value.slice(token.end)}`,
  );
}

/**
 * Treats the intuitive token edges as atomic: Backspace immediately after a
 * token, or Delete immediately before one, removes the whole token.
 */
export function deleteDiscussionMentionTokenAtEdge(
  draft: DiscussionMentionDraft,
  key: 'Backspace' | 'Delete',
  selectionStart: number,
  selectionEnd: number,
): DiscussionMentionAtomicDeletion | null {
  if (selectionStart !== selectionEnd) {
    return null;
  }

  const token = draft.tokens.find((candidate) =>
    key === 'Backspace'
      ? candidate.end === selectionStart
      : candidate.start === selectionStart,
  );

  if (!token) {
    return null;
  }

  return {
    caretPosition: token.start,
    draft: removeDiscussionMentionToken(draft, token.source),
    removedToken: token,
  };
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
