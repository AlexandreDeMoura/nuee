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
