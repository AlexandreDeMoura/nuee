import { describe, expect, it } from 'vitest';
import { findDiscussionMentionQuery } from './discussionMention';

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
