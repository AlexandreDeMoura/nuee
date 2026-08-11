import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Bubble, Territory } from '../src/api';
import { useProjectBubbles } from '../src/canvas/useProjectBubbles';

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-1',
    territory_id: 'territory-1',
    title: 'Canonical knowledge',
    summary: null,
    content: 'One workspace-owned bubble record.',
    created_at: '2026-08-10T08:00:00.000Z',
    updated_at: '2026-08-10T08:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_discussion_title: null,
    source_discussion_deleted_at: null,
    source_message_ids: [],
    source_context_item_ids: [],
    ...overrides,
  };
}

function territory(): Territory {
  return {
    id: 'territory-1',
    project_id: 'project-1',
    kind: 'ungrouped',
    title: 'Ungrouped',
    position_x: 0,
    position_y: 0,
    visible_count: 1,
    created_at: '2026-08-10T08:00:00.000Z',
    updated_at: '2026-08-10T08:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useProjectBubbles', () => {
  it('loads both collections and retains content mutations across retry', async () => {
    const requestBubbles = vi.fn(async () => [bubble()]);
    const requestTerritories = vi.fn(async () => [territory()]);
    const { result } = renderHook(() =>
      useProjectBubbles({
        projectId: 'project-1',
        requestBubbles,
        requestTerritories,
      }),
    );

    await waitFor(() => expect(result.current.loadState.status).toBe('ready'));
    expect(result.current.loadState.territories).toEqual([territory()]);

    const replacement = bubble({ title: 'Revised knowledge' });
    act(() => result.current.replaceBubble(replacement));
    act(() => result.current.retry());

    await waitFor(() => expect(requestBubbles).toHaveBeenCalledTimes(2));
    expect(result.current.loadState.bubbles).toEqual([replacement]);
    expect(requestTerritories).toHaveBeenCalledTimes(2);
  });
});
