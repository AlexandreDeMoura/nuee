import type { TerritoryDestination } from '../api';
import { TERRITORY_TITLE_MAX_LENGTH } from '@nuee/shared-types';
import type { TerritoryCreationPlacement } from '../canvas/territoryPlacement';

export type BubbleDestinationSelection =
  | { kind: 'ungrouped' }
  | { kind: 'existing'; territory_id: string }
  | { kind: 'new'; title: string };

export function getNewTerritoryTitleError(title: string): string | null {
  const normalizedTitle = title.trim();

  if (normalizedTitle.length === 0) {
    return 'Enter a territory title.';
  }

  if (normalizedTitle.length > TERRITORY_TITLE_MAX_LENGTH) {
    return `Use ${TERRITORY_TITLE_MAX_LENGTH} characters or fewer.`;
  }

  return null;
}

export function resolveBubbleDestination(
  selection: BubbleDestinationSelection,
  placement?: TerritoryCreationPlacement,
): TerritoryDestination | null {
  if (selection.kind === 'ungrouped') {
    return { kind: 'ungrouped' };
  }

  if (selection.kind === 'existing') {
    return selection.territory_id.trim().length > 0
      ? { kind: 'existing', territory_id: selection.territory_id }
      : null;
  }

  const title = selection.title.trim();

  return getNewTerritoryTitleError(title) === null && placement
    ? { kind: 'new', title, ...placement }
    : null;
}
