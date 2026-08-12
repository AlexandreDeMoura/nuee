import type { Territory } from '../api';
import type { CanvasViewport } from './canvasTypes';
import { GRID_SIZE } from './canvasModel';
import { TERRITORY_CARD_WIDTH } from './compactTerritoryLayout';

export const EMPTY_TERRITORY_CARD_HEIGHT = 132;

interface TerritoryCreationPlacementInput {
  surfaceHeight: number;
  surfaceWidth: number;
  territories: readonly Pick<Territory, 'position_x' | 'position_y'>[];
  viewport: CanvasViewport;
}

export function getTerritoryCreationPlacement({
  surfaceHeight,
  surfaceWidth,
  territories,
  viewport,
}: TerritoryCreationPlacementInput) {
  const centerX = (surfaceWidth / 2 - viewport.x) / viewport.zoom;
  const centerY = (surfaceHeight / 2 - viewport.y) / viewport.zoom;
  const base = {
    position_x: centerX - TERRITORY_CARD_WIDTH / 2,
    position_y: centerY - EMPTY_TERRITORY_CARD_HEIGHT / 2,
  };
  const occupiedAnchors = new Set(
    territories.map(
      ({ position_x, position_y }) => `${position_x}:${position_y}`,
    ),
  );
  let offset = 0;

  while (
    occupiedAnchors.has(
      `${base.position_x + offset}:${base.position_y + offset}`,
    )
  ) {
    offset += GRID_SIZE;
  }

  return {
    position_x: base.position_x + offset,
    position_y: base.position_y + offset,
  };
}
