import { describe, expect, it } from 'vitest';
import { getTerritoryCreationPlacement } from './territoryPlacement';

describe('getTerritoryCreationPlacement', () => {
  it('centers an empty territory in the current transformed viewport', () => {
    expect(
      getTerritoryCreationPlacement({
        surfaceHeight: 800,
        surfaceWidth: 1200,
        territories: [],
        viewport: { x: 100, y: -50, zoom: 2 },
      }),
    ).toEqual({ position_x: -10, position_y: 159 });
  });

  it('nudges diagonally by one grid unit until the anchor is free', () => {
    expect(
      getTerritoryCreationPlacement({
        surfaceHeight: 600,
        surfaceWidth: 1000,
        territories: [
          { position_x: 240, position_y: 234 },
          { position_x: 264, position_y: 258 },
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toEqual({ position_x: 288, position_y: 282 });
  });
});
