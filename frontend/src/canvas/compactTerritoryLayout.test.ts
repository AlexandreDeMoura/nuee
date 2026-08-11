import { describe, expect, it } from 'vitest';
import {
  getCompactTerritoryPositions,
  TERRITORY_CARD_WIDTH,
  TERRITORY_COMPACT_GAP,
} from './compactTerritoryLayout';

describe('getCompactTerritoryPositions', () => {
  it('packs measured cards into an anchored grid without overlapping rows', () => {
    expect(
      getCompactTerritoryPositions(
        [
          { id: 'first', height: 120 },
          { id: 'second', height: 260 },
          { id: 'third', height: 180 },
          { id: 'fourth', height: 90 },
          { id: 'fifth', height: 140 },
        ],
        { x: -80, y: 40 },
      ),
    ).toEqual([
      { territory_id: 'first', position_x: -80, position_y: 40 },
      {
        territory_id: 'second',
        position_x: -80 + TERRITORY_CARD_WIDTH + TERRITORY_COMPACT_GAP,
        position_y: 40,
      },
      {
        territory_id: 'third',
        position_x: -80 + 2 * (TERRITORY_CARD_WIDTH + TERRITORY_COMPACT_GAP),
        position_y: 40,
      },
      {
        territory_id: 'fourth',
        position_x: -80,
        position_y: 40 + 260 + TERRITORY_COMPACT_GAP,
      },
      {
        territory_id: 'fifth',
        position_x: -80 + TERRITORY_CARD_WIDTH + TERRITORY_COMPACT_GAP,
        position_y: 40 + 260 + TERRITORY_COMPACT_GAP,
      },
    ]);
  });

  it('returns an empty layout for an empty measurement snapshot', () => {
    expect(getCompactTerritoryPositions([], { x: 10, y: 20 })).toEqual([]);
  });
});
