import { describe, expect, it } from 'vitest';
import type { Bubble, Territory } from '../api';
import { groupBubblesByTerritory } from './territoryModel';

function territoryFixture(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-one',
    project_id: 'project-one',
    kind: 'composed',
    title: 'First territory',
    position_x: 24,
    position_y: 24,
    visible_count: 2,
    created_at: '2026-08-10T08:00:00.000Z',
    updated_at: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

function bubbleFixture(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-one',
    project_id: 'project-one',
    territory_id: 'territory-one',
    title: 'Bubble title',
    summary: 'Bubble summary',
    content: 'Bubble content',
    created_at: '2026-08-10T09:00:00.000Z',
    updated_at: '2026-08-10T09:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

describe('groupBubblesByTerritory', () => {
  it('omits empty territories and orders rows by creation time then id', () => {
    const first = territoryFixture();
    const empty = territoryFixture({ id: 'territory-empty' });
    const groups = groupBubblesByTerritory(
      [first, empty],
      [
        bubbleFixture({ id: 'bubble-c', created_at: '2026-08-10T10:00:00.000Z' }),
        bubbleFixture({ id: 'bubble-b' }),
        bubbleFixture({ id: 'bubble-a' }),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].territory).toBe(first);
    expect(groups[0].bubbles.map(({ id }) => id)).toEqual([
      'bubble-a',
      'bubble-b',
      'bubble-c',
    ]);
  });
});
