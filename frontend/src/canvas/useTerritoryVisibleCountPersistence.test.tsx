import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Territory } from '../api';
import { useTerritoryVisibleCountPersistence } from './useTerritoryVisibleCountPersistence';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function territoryFixture(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory-one',
    project_id: 'project-one',
    kind: 'manual',
    title: 'Operations',
    position_x: 0,
    position_y: 0,
    visible_count: 2,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('useTerritoryVisibleCountPersistence', () => {
  it('optimistically debounces rapid changes into the final persisted count', async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    let resolveUpdate!: (territory: Territory) => void;
    const requestUpdate = vi.fn(
      () =>
        new Promise<Territory>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    const targets = [{ territory: territoryFixture(), total: 5 }] as const;
    const { result } = renderHook(() =>
      useTerritoryVisibleCountPersistence({
        onSaveStatusChange: (status) => statuses.push(status),
        projectId: 'project-one',
        requestUpdate,
        saveDelayMs: 50,
        targets,
      }),
    );

    act(() => {
      result.current.changeVisibleCount('territory-one', 3);
      result.current.changeVisibleCount('territory-one', 4);
    });

    expect(result.current.localCounts['territory-one']).toBe(4);
    expect(result.current.saves['territory-one']?.status).toBe('dirty');
    expect(statuses.at(-1)).toBe('dirty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(49);
    });
    expect(requestUpdate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith(
      'project-one',
      'territory-one',
      { visible_count: 4 },
    );
    expect(result.current.saves['territory-one']?.status).toBe('saving');
    expect(statuses.at(-1)).toBe('saving');

    await act(async () => {
      resolveUpdate(
        territoryFixture({
          updated_at: '2026-08-01T10:01:00.000Z',
          visible_count: 4,
        }),
      );
      await Promise.resolve();
    });
    expect(result.current.localCounts['territory-one']).toBe(4);
    expect(result.current.saves['territory-one']).toBeUndefined();
    expect(statuses.at(-1)).toBe('saved');
  });

  it('clamps the local count when deletion lowers the territory total', () => {
    const requestUpdate = vi.fn();
    const initialTerritory = territoryFixture({ visible_count: 4 });
    const { result, rerender } = renderHook(
      ({ total }) =>
        useTerritoryVisibleCountPersistence({
          projectId: 'project-one',
          requestUpdate,
          targets: [{ territory: initialTerritory, total }],
        }),
      { initialProps: { total: 4 } },
    );

    expect(result.current.localCounts['territory-one']).toBe(4);
    rerender({ total: 2 });

    expect(result.current.localCounts['territory-one']).toBe(2);
    expect(result.current.saves['territory-one']).toBeUndefined();
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('keeps a failed optimistic value retryable and supports reverting it', async () => {
    vi.useFakeTimers();
    const requestUpdate = vi.fn(async () => {
      throw new Error('offline');
    });
    const targets = [{ territory: territoryFixture(), total: 4 }] as const;
    const { result } = renderHook(() =>
      useTerritoryVisibleCountPersistence({
        projectId: 'project-one',
        requestUpdate,
        saveDelayMs: 10,
        targets,
      }),
    );

    act(() => result.current.changeVisibleCount('territory-one', 3));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current.localCounts['territory-one']).toBe(3);
    expect(result.current.saves['territory-one']?.status).toBe('error');

    act(() => result.current.retrySave('territory-one'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(requestUpdate).toHaveBeenCalledTimes(2);
    expect(result.current.saves['territory-one']?.status).toBe('error');

    act(() => result.current.revertSave('territory-one'));
    expect(result.current.localCounts['territory-one']).toBe(2);
    expect(result.current.saves['territory-one']).toBeUndefined();
  });
});
