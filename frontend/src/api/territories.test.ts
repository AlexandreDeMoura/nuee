import { describe, expect, it, vi } from 'vitest';
import {
  createTerritoriesApi,
  type TerritoriesRequest,
} from './territories';

const territory = {
  id: 'territory-one',
  project_id: 'project/one',
  kind: 'manual',
  title: 'Research',
  position_x: 10,
  position_y: 20,
  visible_count: 2,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:01:00.000Z',
} as const;

describe('territories mutation API', () => {
  it('renames a project-scoped territory and validates the returned record', async () => {
    const requestSpy = vi.fn();
    const request: TerritoriesRequest = async <T>(
      path: string,
      init?: RequestInit,
    ) => {
      requestSpy(path, init);
      return territory as T;
    };
    const api = createTerritoriesApi(request);
    const controller = new AbortController();

    await expect(
      api.renameTerritory(
        'project/one',
        'territory-one',
        { title: 'Research' },
        controller.signal,
      ),
    ).resolves.toEqual(territory);
    expect(requestSpy).toHaveBeenCalledWith(
      '/projects/project%2Fone/territories/territory-one',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Research' }),
        signal: controller.signal,
      },
    );
  });

  it('deletes a project-scoped territory and rejects malformed move counts', async () => {
    const responses: unknown[] = [
      { moved_bubble_count: 3 },
      { moved_bubble_count: -1 },
    ];
    const requestSpy = vi.fn();
    const request: TerritoriesRequest = async <T>(
      path: string,
      init?: RequestInit,
    ) => {
      requestSpy(path, init);
      return responses.shift() as T;
    };
    const api = createTerritoriesApi(request);

    await expect(
      api.deleteTerritory('project/one', 'territory/one'),
    ).resolves.toEqual({ moved_bubble_count: 3 });
    expect(requestSpy).toHaveBeenNthCalledWith(
      1,
      '/projects/project%2Fone/territories/territory%2Fone',
      { method: 'DELETE', signal: undefined },
    );
    await expect(
      api.deleteTerritory('project/one', 'territory/one'),
    ).rejects.toThrow('invalid data');
  });
});
