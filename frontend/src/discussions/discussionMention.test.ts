import { describe, expect, it } from 'vitest';
import type { DiscussionSourceCatalogItem } from './discussionSourceCatalog';
import {
  attachDiscussionMentionSource,
  createDiscussionMentionDraft,
  deleteDiscussionMentionTokenAtEdge,
  findDiscussionMentionQuery,
  removeDiscussionMentionToken,
  updateDiscussionMentionDraft,
} from './discussionMention';

const bubble: DiscussionSourceCatalogItem = {
  id: 'bubble-retention',
  kind: 'bubble',
  secondaryLine: 'Accounts that never invite a teammate',
  title: 'Retention signal',
};

const document: DiscussionSourceCatalogItem = {
  id: 'document-quarterly',
  kind: 'document',
  readiness: { status: 'ready' },
  secondaryLine: 'PDF · 14 pages',
  title: 'Quarterly review',
};

describe('findDiscussionMentionQuery', () => {
  it('returns the query after a standalone trigger at the caret', () => {
    expect(findDiscussionMentionQuery('Compare @retention', 18)).toEqual({
      query: 'retention',
      triggerIndex: 8,
    });
  });

  it('supports a trigger at the beginning and queries containing spaces', () => {
    expect(findDiscussionMentionQuery('@quarterly review', 17)).toEqual({
      query: 'quarterly review',
      triggerIndex: 0,
    });
    expect(findDiscussionMentionQuery('Compare (@review', 16)).toEqual({
      query: 'review',
      triggerIndex: 9,
    });
  });

  it('ignores email-like text and triggers outside the caret line', () => {
    expect(findDiscussionMentionQuery('name@example.com', 16)).toBeNull();
    expect(findDiscussionMentionQuery('@first\nsecond', 13)).toBeNull();
  });
});

describe('discussion mention draft', () => {
  it('replaces a query with a plain-text token and deduplicates its source', () => {
    const initial = createDiscussionMentionDraft('Compare @retention today');
    const mention = findDiscussionMentionQuery(initial.value, 18);

    expect(mention).not.toBeNull();
    const attached = attachDiscussionMentionSource(initial, bubble, mention!);

    expect(attached.attached).toBe(true);
    expect(attached.draft.value).toBe('Compare Retention signal today');
    expect(attached.draft.tokens).toEqual([
      { end: 24, source: bubble, start: 8 },
    ]);
    expect(
      attachDiscussionMentionSource(attached.draft, bubble, {
        query: '',
        triggerIndex: 0,
      }),
    ).toEqual({
      attached: false,
      caretPosition: 1,
      draft: attached.draft,
    });
  });

  it('shifts later tokens and detaches only a token intersected by an edit', () => {
    const firstAttachment = attachDiscussionMentionSource(
      createDiscussionMentionDraft('@retention and @quarterly'),
      bubble,
      { query: 'retention', triggerIndex: 0 },
    ).draft;
    const secondTrigger = firstAttachment.value.indexOf('@quarterly');
    const withTwoTokens = attachDiscussionMentionSource(
      firstAttachment,
      document,
      { query: 'quarterly', triggerIndex: secondTrigger },
    ).draft;

    const prefixed = updateDiscussionMentionDraft(
      withTwoTokens,
      `Please ${withTwoTokens.value}`,
    );
    expect(prefixed.tokens.map(({ start }) => start)).toEqual([7, 28]);

    const edited = updateDiscussionMentionDraft(
      prefixed,
      prefixed.value.replace('Retention', 'Activation'),
    );
    expect(edited.tokens).toEqual([
      { end: 45, source: document, start: 29 },
    ]);
  });

  it('removes token text from a chip action and deletes atomically at an edge', () => {
    const attached = attachDiscussionMentionSource(
      createDiscussionMentionDraft('Ask @retention'),
      bubble,
      { query: 'retention', triggerIndex: 4 },
    ).draft;
    const token = attached.tokens[0];
    const deletion = deleteDiscussionMentionTokenAtEdge(
      attached,
      'Backspace',
      token.end,
      token.end,
    );

    expect(deletion?.draft.value).toBe('Ask  ');
    expect(deletion?.draft.tokens).toEqual([]);
    expect(deletion?.caretPosition).toBe(4);
    expect(removeDiscussionMentionToken(attached, bubble)).toEqual(
      deletion?.draft,
    );
  });
});
