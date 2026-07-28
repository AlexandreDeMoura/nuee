import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { DiscussionListResponse } from '../src/api';
import { useProjectDiscussions } from '../src/discussions';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function listFor(projectId: string): DiscussionListResponse {
  return [
    {
      id: `discussion-${projectId}`,
      project_id: projectId,
      title: `Discussion for ${projectId}`,
      created_at: '2026-07-28T08:00:00.000Z',
      updated_at: '2026-07-28T09:00:00.000Z',
      last_activity_at: '2026-07-28T09:00:00.000Z',
      is_active: true,
    },
  ];
}

describe('project discussions loader', () => {
  it('aborts a previous project load and ignores its stale response', async () => {
    const first = deferred<DiscussionListResponse>();
    const second = deferred<DiscussionListResponse>();
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    const list = vi.fn(
      (projectId: string, signal?: AbortSignal) => {
        if (projectId === 'project-1') {
          firstSignal = signal;
          return first.promise;
        }

        secondSignal = signal;
        return second.promise;
      },
    );
    const { result, rerender, unmount } = renderHook(
      ({ projectId }) =>
        useProjectDiscussions({
          enabled: true,
          projectId,
          requests: { list },
        }),
      { initialProps: { projectId: 'project-1' } },
    );

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    rerender({ projectId: 'project-2' });

    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(listFor('project-1'));
      second.resolve(listFor('project-2'));
    });

    await waitFor(() =>
      expect(result.current.discussions.map(({ id }) => id)).toEqual([
        'discussion-project-2',
      ]),
    );

    unmount();
    expect(secondSignal?.aborted).toBe(true);
  });

  it('surfaces an invalid response and retries through the injected request', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(listFor('another-project'))
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() =>
      useProjectDiscussions({
        enabled: true,
        projectId: 'project-1',
        requests: { list },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe(
      'The discussion list response contained invalid data.',
    );

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.discussions).toEqual([]);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('removes a deleted record, recalculates Active, and ignores stale list copies', async () => {
    const projectId = 'project-1';
    const older = listFor(projectId)[0];
    const latest = {
      ...older,
      id: 'discussion-latest',
      title: 'Latest discussion',
      updated_at: '2026-07-28T10:00:00.000Z',
      last_activity_at: '2026-07-28T10:00:00.000Z',
    };
    const records = [older, latest];
    const staleRefresh = deferred<DiscussionListResponse>();
    const list = vi
      .fn()
      .mockResolvedValueOnce(records)
      .mockImplementationOnce(() => staleRefresh.promise);
    const deleteRequest = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useProjectDiscussions({
        enabled: true,
        projectId,
        requests: { delete: deleteRequest, list },
      }),
    );

    await waitFor(() =>
      expect(result.current.discussions.map(({ id }) => id)).toEqual([
        latest.id,
        older.id,
      ]),
    );

    act(() => result.current.refresh());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    let wasDeleted = false;
    await act(async () => {
      wasDeleted = await result.current.deleteDiscussion({
        id: latest.id,
      });
    });

    expect(wasDeleted).toBe(true);
    expect(deleteRequest).toHaveBeenCalledWith(
      projectId,
      latest.id,
      expect.any(AbortSignal),
    );
    expect(result.current.discussions).toEqual([
      expect.objectContaining({
        id: older.id,
        is_active: true,
      }),
    ]);

    await act(async () => staleRefresh.resolve(records));

    expect(result.current.discussions.map(({ id }) => id)).toEqual([
      older.id,
    ]);
  });

  it('keeps a failed delete in the list and clears the error before retrying', async () => {
    const projectId = 'project-1';
    const deleteRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('Deletion unavailable.'))
      .mockResolvedValueOnce(undefined);
    const list = vi.fn(async () => listFor(projectId));
    const { result } = renderHook(() =>
      useProjectDiscussions({
        enabled: true,
        projectId,
        requests: {
          delete: deleteRequest,
          list,
        },
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.deleteDiscussion({
        id: `discussion-${projectId}`,
      });
    });

    expect(result.current.deleteError).toBe('Deletion unavailable.');
    expect(result.current.discussions).toHaveLength(1);

    act(() => result.current.clearDeleteError());
    expect(result.current.deleteError).toBeNull();

    await act(async () => {
      await result.current.deleteDiscussion({
        id: `discussion-${projectId}`,
      });
    });

    expect(result.current.discussions).toEqual([]);
    expect(deleteRequest).toHaveBeenCalledTimes(2);
  });
});
