import type { Bubble, Territory } from '../api';

export interface TerritoryWithBubbles {
  territory: Territory;
  bubbles: Bubble[];
}

function compareBubbles(first: Bubble, second: Bubble) {
  return (
    first.created_at.localeCompare(second.created_at) ||
    first.id.localeCompare(second.id)
  );
}

export function groupBubblesByTerritory(
  territories: readonly Territory[],
  bubbles: readonly Bubble[],
): TerritoryWithBubbles[] {
  const bubblesByTerritoryId = new Map<string, Bubble[]>();

  for (const bubble of bubbles) {
    const territoryBubbles =
      bubblesByTerritoryId.get(bubble.territory_id) ?? [];
    territoryBubbles.push(bubble);
    bubblesByTerritoryId.set(bubble.territory_id, territoryBubbles);
  }

  return territories.flatMap((territory) => {
    const territoryBubbles = bubblesByTerritoryId.get(territory.id) ?? [];

    if (territory.kind === 'ungrouped' && territoryBubbles.length === 0) {
      return [];
    }

    return [
      {
        territory,
        bubbles: [...territoryBubbles].sort(compareBubbles),
      },
    ];
  });
}
