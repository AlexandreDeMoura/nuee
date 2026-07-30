import { describe, expect, it } from 'vitest';
import type { Bubble } from '../src/api';
import { isBubbleResponse } from '../src/api';

function manualBubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-1',
    title: 'Manual knowledge',
    summary: null,
    content: 'Durable project knowledge.',
    position_x: 12,
    position_y: -24,
    created_at: '2026-07-29T08:00:00.000Z',
    updated_at: '2026-07-29T08:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

describe('isBubbleResponse', () => {
  it('accepts complete manual and discussion extraction provenance', () => {
    expect(isBubbleResponse(manualBubble(), 'project-1')).toBe(true);
    expect(
      isBubbleResponse(
        manualBubble({
          source_kind: 'discussion',
          source_discussion_id: 'discussion-1',
          source_discussion_title: 'Launch tradeoffs',
          source_discussion_deleted_at: '2026-07-29T10:00:00.000Z',
          source_message_ids: ['message-1'],
          source_context_item_ids: ['context-1'],
        }),
        'project-1',
      ),
    ).toBe(true);
  });

  it.each([
    {
      source_discussion_id: 'discussion-1',
    },
    {
      source_kind: 'discussion',
      source_discussion_id: 'discussion-1',
      source_discussion_title: null,
      source_message_ids: ['message-1'],
    },
    {
      source_kind: 'discussion',
      source_discussion_id: 'discussion-1',
      source_discussion_title: 'Launch tradeoffs',
      source_message_ids: [],
      source_context_item_ids: [],
    },
    {
      source_kind: 'discussion',
      source_discussion_id: 'discussion-1',
      source_discussion_title: 'Launch tradeoffs',
      source_discussion_deleted_at: 'not-a-timestamp',
      source_message_ids: ['message-1'],
    },
    {
      source_kind: 'discussion',
      source_discussion_id: 'discussion-1',
      source_discussion_title: 'Launch tradeoffs',
      source_message_ids: ['message-1', 'message-1'],
    },
  ])('rejects inconsistent provenance %#', (overrides) => {
    expect(
      isBubbleResponse(manualBubble(overrides as Partial<Bubble>), 'project-1'),
    ).toBe(false);
  });
});
