import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  renderHook,
  waitFor,
} from '@testing-library/react';
import type { Bubble } from '../src/api';
import { useProjectBubbles } from '../src/canvas/useProjectBubbles';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function bubble(overrides: Partial<Bubble> = {}): Bubble {
  return {
    id: 'bubble-1',
    project_id: 'project-1',
    title: 'Canonical knowledge',
    summary: null,
    content: 'One workspace-owned bubble record.',
    position_x: 120,
    position_y: -48,
    created_at: '2026-07-29T08:00:00.000Z',
    updated_at: '2026-07-29T08:00:00.000Z',
    source_kind: 'manual',
    source_discussion_id: null,
    source_message_ids: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useProjectBubbles', () => {
  it('owns one collection across load, content, position, creation, and deletion changes', async () => {
    const pendingLoad = deferred<Bubble[]>();
    const requestBubbles = vi.fn(() => pendingLoad.promise);
    const { result } = renderHook(() =>
      useProjectBubbles({
        projectId: 'project-1',
        requestBubbles,
      }),
    );

    expect(result.current.loadState).toEqual({
      status: 'loading',
      bubbles: [],
    });

    const createdDuringLoad = bubble({
      id: 'bubble-created',
      title: 'Persisted while loading',
    });
    act(() => result.current.addBubble(createdDuringLoad));
    await act(async () => pendingLoad.resolve([bubble()]));

    expect(result.current.loadState.status).toBe('ready');
    expect(result.current.loadState.bubbles.map(({ id }) => id)).toEqual([
      'bubble-1',
      'bubble-created',
    ]);

    act(() =>
      result.current.replaceBubble(
        bubble({
          title: 'Revised canonical knowledge',
          position_x: 999,
          position_y: 999,
          updated_at: '2026-07-29T08:01:00.000Z',
        }),
      ),
    );

    expect(result.current.loadState.bubbles[0]).toEqual(
      expect.objectContaining({
        title: 'Revised canonical knowledge',
        position_x: 120,
        position_y: -48,
      }),
    );

    act(() =>
      result.current.updateBubblePositions([
        {
          bubble_id: 'bubble-1',
          position_x: 180,
          position_y: 24,
        },
      ]),
    );

    expect(result.current.loadState.bubbles[0]).toEqual(
      expect.objectContaining({
        title: 'Revised canonical knowledge',
        position_x: 180,
        position_y: 24,
      }),
    );

    act(() => result.current.removeBubble('bubble-1'));

    expect(result.current.loadState.bubbles).toEqual([createdDuringLoad]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loadState.status).toBe('ready'));
    expect(result.current.loadState.bubbles).toEqual([createdDuringLoad]);
    expect(requestBubbles).toHaveBeenCalledWith(
      'project-1',
      expect.any(AbortSignal),
    );
    expect(requestBubbles).toHaveBeenCalledTimes(2);
  });

  it('aborts obsolete loads and ignores their stale results after the project changes', async () => {
    const firstLoad = deferred<Bubble[]>();
    const secondLoad = deferred<Bubble[]>();
    const requestBubbles = vi.fn(
      (projectId: string, signal?: AbortSignal) => {
        void signal;
        return projectId === 'project-1'
          ? firstLoad.promise
          : secondLoad.promise;
      },
    );
    const { rerender, result } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useProjectBubbles({ projectId, requestBubbles }),
      { initialProps: { projectId: 'project-1' } },
    );
    const firstSignal = requestBubbles.mock.calls[0]?.[1];

    rerender({ projectId: 'project-2' });

    await waitFor(() => expect(requestBubbles).toHaveBeenCalledTimes(2));
    expect(firstSignal?.aborted).toBe(true);

    const secondProjectBubble = bubble({
      id: 'bubble-project-2',
      project_id: 'project-2',
      title: 'Second project knowledge',
    });
    await act(async () => secondLoad.resolve([secondProjectBubble]));

    expect(result.current.projectId).toBe('project-2');
    expect(result.current.loadState).toEqual({
      status: 'ready',
      bubbles: [secondProjectBubble],
    });

    await act(async () =>
      firstLoad.resolve([
        bubble({ title: 'Stale first project knowledge' }),
      ]),
    );

    expect(result.current.loadState).toEqual({
      status: 'ready',
      bubbles: [secondProjectBubble],
    });
  });
});
