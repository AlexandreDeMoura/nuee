import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Bubble, Territory } from '../api';
import { useProjectBubbles } from './useProjectBubbles';

const manualTerritory: Territory = {
  id: 'territory-manual',
  project_id: 'project-one',
  kind: 'manual',
  title: 'Operations',
  position_x: 0,
  position_y: 0,
  visible_count: 1,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
};

const ungroupedTerritory: Territory = {
  ...manualTerritory,
  id: 'territory-ungrouped',
  kind: 'ungrouped',
  title: 'Ungrouped',
};

const bubble: Bubble = {
  id: 'bubble-one',
  project_id: 'project-one',
  territory_id: manualTerritory.id,
  title: 'Bubble one',
  summary: null,
  content: 'Content',
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  source_kind: 'manual',
  source_discussion_id: null,
  source_discussion_title: null,
  source_discussion_deleted_at: null,
  source_message_ids: [],
  source_context_item_ids: [],
};

describe('useProjectBubbles refresh', () => {
  it('drops already-persisted local mutations before reloading server reassignment', async () => {
    let deleted = false;
    const requestBubbles = vi.fn(async () =>
      deleted
        ? [{ ...bubble, title: 'Edited', territory_id: ungroupedTerritory.id }]
        : [bubble],
    );
    const requestTerritories = vi.fn(async () =>
      deleted ? [ungroupedTerritory] : [manualTerritory],
    );
    const { result } = renderHook(() =>
      useProjectBubbles({
        projectId: 'project-one',
        requestBubbles,
        requestTerritories,
      }),
    );

    await waitFor(() => expect(result.current.loadState.status).toBe('ready'));
    act(() => {
      result.current.replaceBubble({ ...bubble, title: 'Edited' });
    });

    deleted = true;
    act(() => {
      result.current.removeTerritory(manualTerritory.id);
      result.current.refresh();
    });

    await waitFor(() => {
      expect(requestBubbles).toHaveBeenCalledTimes(2);
      expect(result.current.loadState.status).toBe('ready');
    });
    expect(result.current.loadState.bubbles).toEqual([
      { ...bubble, title: 'Edited', territory_id: ungroupedTerritory.id },
    ]);
    expect(result.current.loadState.territories).toEqual([
      ungroupedTerritory,
    ]);
  });
});
