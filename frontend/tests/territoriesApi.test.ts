import { describe, expect, it } from 'vitest';
import type { Territory } from '../src/api';
import {
  createTerritoriesApi,
  isTerritoryResponse,
  type TerritoriesRequest,
} from '../src/api/territories';

function territory(overrides: Partial<Territory> = {}): Territory {
  return {
    id: 'territory/1',
    project_id: 'project/1',
    kind: 'ungrouped',
    title: 'Ungrouped',
    position_x: 24,
    position_y: -12,
    visible_count: 4,
    created_at: '2026-08-10T08:00:00.000Z',
    updated_at: '2026-08-10T08:00:00.000Z',
    ...overrides,
  };
}

describe('territories API', () => {
  it('requests and validates the project-scoped territory list', async () => {
    const saved = territory();
    const calls: string[] = [];
    const request: TerritoriesRequest = <T>(path: string): Promise<T> => {
      calls.push(path);
      return Promise.resolve([saved] as T);
    };

    await expect(
      createTerritoriesApi(request).getProjectTerritories('project/1'),
    ).resolves.toEqual([saved]);
    expect(calls).toEqual(['/projects/project%2F1/territories']);
  });

  it('repositions one territory and a validated batch', async () => {
    const first = territory({ position_x: 100, position_y: 200 });
    const second = territory({
      id: 'territory/2',
      kind: 'composed',
      position_x: 644,
      position_y: 200,
    });
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const responses: unknown[] = [first, [first, second]];
    const request: TerritoriesRequest = <T>(
      path: string,
      init?: RequestInit,
    ): Promise<T> => {
      calls.push({ path, init });
      return Promise.resolve(responses.shift() as T);
    };
    const api = createTerritoriesApi(request);

    await expect(
      api.repositionTerritory('project/1', 'territory/1', {
        position_x: 100,
        position_y: 200,
      }),
    ).resolves.toEqual(first);
    await expect(
      api.repositionTerritories('project/1', {
        positions: [
          { territory_id: 'territory/1', position_x: 100, position_y: 200 },
          { territory_id: 'territory/2', position_x: 644, position_y: 200 },
        ],
      }),
    ).resolves.toEqual([first, second]);

    expect(calls.map(({ path }) => path)).toEqual([
      '/projects/project%2F1/territories/territory%2F1/position',
      '/projects/project%2F1/territories/positions',
    ]);
    expect(calls.every(({ init }) => init?.method === 'PATCH')).toBe(true);
  });

  it('rejects mismatched reposition responses', async () => {
    const request: TerritoriesRequest = <T>(): Promise<T> =>
      Promise.resolve(territory({ id: 'territory/elsewhere' }) as T);

    await expect(
      createTerritoriesApi(request).repositionTerritory(
        'project/1',
        'territory/1',
        { position_x: 10, position_y: 20 },
      ),
    ).rejects.toThrow('The territory list response contained invalid data.');
  });

  it('rejects invalid, duplicate, and cross-project territory records', async () => {
    expect(isTerritoryResponse(territory(), 'project/1')).toBe(true);
    expect(
      isTerritoryResponse(territory({ project_id: 'project/2' }), 'project/1'),
    ).toBe(false);
    expect(
      isTerritoryResponse(territory({ visible_count: 0 }), 'project/1'),
    ).toBe(false);

    for (const response of [
      [territory(), territory()],
      [territory(), territory({ id: 'territory/2' })],
    ]) {
      const request: TerritoriesRequest = <T>(): Promise<T> =>
        Promise.resolve(response as T);

      await expect(
        createTerritoriesApi(request).getProjectTerritories('project/1'),
      ).rejects.toThrow('The territory list response contained invalid data.');
    }
  });
});
