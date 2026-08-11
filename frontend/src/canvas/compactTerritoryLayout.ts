import type { TerritoryPositionUpdate } from '../api';

export const TERRITORY_CARD_WIDTH = 520;
export const TERRITORY_COMPACT_GAP = 24;

export interface MeasuredTerritory {
  id: string;
  height: number;
}

export interface CompactLayoutAnchor {
  x: number;
  y: number;
}

export function getCompactTerritoryPositions(
  territories: readonly MeasuredTerritory[],
  anchor: CompactLayoutAnchor,
): TerritoryPositionUpdate[] {
  if (territories.length === 0) {
    return [];
  }

  const columnCount = Math.ceil(Math.sqrt(territories.length));
  const positions: TerritoryPositionUpdate[] = [];
  let rowY = anchor.y;

  for (
    let rowStart = 0;
    rowStart < territories.length;
    rowStart += columnCount
  ) {
    const row = territories.slice(rowStart, rowStart + columnCount);
    const rowHeight = Math.max(...row.map(({ height }) => Math.max(0, height)));

    row.forEach((territory, columnIndex) => {
      positions.push({
        territory_id: territory.id,
        position_x:
          anchor.x +
          columnIndex * (TERRITORY_CARD_WIDTH + TERRITORY_COMPACT_GAP),
        position_y: rowY,
      });
    });

    rowY += rowHeight + TERRITORY_COMPACT_GAP;
  }

  return positions;
}
