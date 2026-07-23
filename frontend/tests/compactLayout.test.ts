import { describe, expect, it } from 'vitest';
import type { Bubble } from '../src/api';
import {
  BUBBLE_CARD_HEIGHT,
  BUBBLE_CARD_WIDTH,
  COMPACT_LAYOUT_GAP,
  getCompactBubblePositions,
} from '../src/canvas/compactLayout';

function bubble(
  id: string,
  position_x: number,
  position_y: number,
  created_at: string,
): Bubble {
  return {
    id,
    project_id: 'project-123',
    title: `Bubble ${id}`,
    summary: null,
    content: `Content for ${id}`,
    position_x,
    position_y,
    created_at,
    updated_at: created_at,
    source_kind: 'manual',
    source_discussion_id: null,
    source_message_ids: [],
  };
}

describe('getCompactBubblePositions', () => {
  it('creates a deterministic dense grid with the configured minimum gap', () => {
    const bubbles = [
      bubble('fifth', 800, 700, '2026-07-21T09:04:00.000Z'),
      bubble('first', -120, -80, '2026-07-21T09:00:00.000Z'),
      bubble('third', 450, 100, '2026-07-21T09:02:00.000Z'),
      bubble('second', 300, -80, '2026-07-21T09:01:00.000Z'),
      bubble('fourth', -20, 500, '2026-07-21T09:03:00.000Z'),
    ];

    const positions = getCompactBubblePositions(bubbles);

    expect(positions).toEqual([
      { bubble_id: 'first', position_x: -120, position_y: -80 },
      {
        bubble_id: 'second',
        position_x: -120 + BUBBLE_CARD_WIDTH + COMPACT_LAYOUT_GAP,
        position_y: -80,
      },
      {
        bubble_id: 'third',
        position_x: -120 + 2 * (BUBBLE_CARD_WIDTH + COMPACT_LAYOUT_GAP),
        position_y: -80,
      },
      {
        bubble_id: 'fourth',
        position_x: -120,
        position_y: -80 + BUBBLE_CARD_HEIGHT + COMPACT_LAYOUT_GAP,
      },
      {
        bubble_id: 'fifth',
        position_x: -120 + BUBBLE_CARD_WIDTH + COMPACT_LAYOUT_GAP,
        position_y: -80 + BUBBLE_CARD_HEIGHT + COMPACT_LAYOUT_GAP,
      },
    ]);
  });

  it('is idempotent once bubbles occupy the compact positions', () => {
    const bubbles = [
      bubble('later', 900, 500, '2026-07-21T09:01:00.000Z'),
      bubble('earlier', 100, 200, '2026-07-21T09:00:00.000Z'),
      bubble('last', -50, 700, '2026-07-21T09:02:00.000Z'),
    ];
    const firstLayout = getCompactBubblePositions(bubbles);
    const compacted = bubbles.map((candidate) => {
      const position = firstLayout.find(
        (item) => item.bubble_id === candidate.id,
      )!;

      return {
        ...candidate,
        position_x: position.position_x,
        position_y: position.position_y,
      };
    });

    expect(getCompactBubblePositions(compacted)).toEqual(firstLayout);
  });
});
