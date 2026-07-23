import type { Bubble, BubblePositionUpdate } from '../api';

export const BUBBLE_CARD_WIDTH = 248;
export const BUBBLE_CARD_HEIGHT = 154;
export const COMPACT_LAYOUT_GAP = 24;

function compareSpatialOrder(first: Bubble, second: Bubble) {
  return (
    first.position_y - second.position_y ||
    first.position_x - second.position_x ||
    first.created_at.localeCompare(second.created_at) ||
    first.id.localeCompare(second.id)
  );
}

export function getCompactBubblePositions(
  bubbles: readonly Bubble[],
): BubblePositionUpdate[] {
  if (bubbles.length === 0) {
    return [];
  }

  const anchorX = Math.min(...bubbles.map((bubble) => bubble.position_x));
  const anchorY = Math.min(...bubbles.map((bubble) => bubble.position_y));
  const columnCount = Math.ceil(Math.sqrt(bubbles.length));

  return [...bubbles]
    .sort(compareSpatialOrder)
    .map((bubble, index) => ({
      bubble_id: bubble.id,
      position_x:
        anchorX +
        (index % columnCount) * (BUBBLE_CARD_WIDTH + COMPACT_LAYOUT_GAP),
      position_y:
        anchorY +
        Math.floor(index / columnCount) *
          (BUBBLE_CARD_HEIGHT + COMPACT_LAYOUT_GAP),
    }));
}
