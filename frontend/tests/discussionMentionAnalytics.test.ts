import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsClient } from '../src/analytics';
import {
  assertPrivacySafeDiscussionMentionAnalytics,
  trackDiscussionMentionAnalytics,
} from '../src/discussions';

describe('discussion mention analytics privacy boundary', () => {
  it.each([
    ['title', 'Private source title'],
    ['draft', 'Private prompt content'],
    ['content', 'Frozen source contents'],
  ])('rejects the sensitive %s property', (property, value) => {
    expect(() =>
      assertPrivacySafeDiscussionMentionAnalytics(
        'discussion_mention_source_attached',
        {
          project_id: 'project-1',
          source_id: 'bubble-1',
          source_kind: 'bubble',
          input_method: 'keyboard',
          [property]: value,
        },
      ),
    ).toThrow(/unsafe properties/u);
  });

  it('publishes only aggregate creation counts and identifiers', () => {
    const track = vi.fn<AnalyticsClient['track']>();

    trackDiscussionMentionAnalytics(
      { track },
      'discussion_context_sources_frozen',
      {
        project_id: 'project-1',
        discussion_id: 'discussion-1',
        bubble_count: 2,
        document_count: 1,
        attached_source_count: 3,
        frozen_source_count: 4,
      },
    );

    expect(track).toHaveBeenCalledWith(
      'discussion_context_sources_frozen',
      {
        project_id: 'project-1',
        discussion_id: 'discussion-1',
        bubble_count: 2,
        document_count: 1,
        attached_source_count: 3,
        frozen_source_count: 4,
      },
    );
  });
});
