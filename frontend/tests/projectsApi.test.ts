import type { Project } from '@nuee/shared-types';
import { describe, expect, it } from 'vitest';
import {
  createProjectsApi,
  isProjectResponse,
  isProjectsResponse,
  type ProjectsRequest,
} from '../src/api/projects';

interface RecordedRequest {
  init?: RequestInit;
  path: string;
}

function createRequestFake(responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: ProjectsRequest = <T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> => {
    requests.push({ init, path });
    return Promise.resolve(responses.shift() as T);
  };

  return { request, requests };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project/1',
    title: 'Research project',
    description: 'Compare the available approaches.',
    created_at: '2026-08-03T08:00:00.000Z',
    updated_at: '2026-08-03T08:01:00.000Z',
    canvas_viewport_x: 24,
    canvas_viewport_y: -48,
    canvas_zoom: 1.25,
    ...overrides,
  };
}

describe('projects API', () => {
  it('validates all project reads and mutations at the API boundary', async () => {
    const savedProject = project();
    const { request, requests } = createRequestFake([
      [savedProject],
      savedProject,
      savedProject,
      savedProject,
      savedProject,
    ]);
    const api = createProjectsApi(request);
    const signal = new AbortController().signal;

    await expect(api.getProjects(signal)).resolves.toEqual([savedProject]);
    await expect(api.getProject('project/1', signal)).resolves.toBe(savedProject);
    await expect(
      api.createProject({ title: 'Research project', description: '' }),
    ).resolves.toBe(savedProject);
    await expect(
      api.updateProjectDescription(
        'project/1',
        { description: 'Updated.' },
        signal,
      ),
    ).resolves.toBe(savedProject);
    await expect(
      api.updateProjectViewport(
        'project/1',
        {
          canvas_viewport_x: 24,
          canvas_viewport_y: -48,
          canvas_zoom: 1.25,
        },
        { keepalive: true },
      ),
    ).resolves.toBe(savedProject);

    expect(requests).toEqual([
      { path: '/projects', init: { signal } },
      { path: '/projects/project%2F1', init: { signal } },
      {
        path: '/projects',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Research project', description: '' }),
        },
      },
      {
        path: '/projects/project%2F1/description',
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'Updated.' }),
          signal,
        },
      },
      {
        path: '/projects/project%2F1/viewport',
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canvas_viewport_x: 24,
            canvas_viewport_y: -48,
            canvas_zoom: 1.25,
          }),
          keepalive: true,
        },
      },
    ]);
  });

  it('rejects malformed viewport values, timestamps, and resource identities', () => {
    expect(isProjectResponse(project(), 'project/1')).toBe(true);

    for (const invalidProject of [
      project({ canvas_viewport_x: Number.NaN }),
      project({ canvas_viewport_y: Number.POSITIVE_INFINITY }),
      project({ canvas_zoom: 0.24 }),
      project({ canvas_zoom: 2.01 }),
      project({ created_at: 'not-a-timestamp' }),
      project({ updated_at: '2026-08-03T07:59:00.000Z' }),
    ]) {
      expect(isProjectResponse(invalidProject, 'project/1')).toBe(false);
    }

    expect(isProjectResponse(project(), 'project/2')).toBe(false);
  });

  it('rejects invalid responses from every project endpoint', async () => {
    const invalidProject = project({ canvas_zoom: Number.NaN });
    const { request } = createRequestFake([
      [invalidProject],
      { ...project(), id: 'project/2' },
      invalidProject,
      invalidProject,
      invalidProject,
    ]);
    const api = createProjectsApi(request);

    await expect(api.getProjects()).rejects.toThrow(
      'The project list response contained invalid data.',
    );
    await expect(api.getProject('project/1')).rejects.toThrow(
      'The project response contained invalid data.',
    );
    await expect(
      api.createProject({ title: 'Research project', description: '' }),
    ).rejects.toThrow('The project response contained invalid data.');
    await expect(
      api.updateProjectDescription('project/1', { description: 'Updated.' }),
    ).rejects.toThrow('The project response contained invalid data.');
    await expect(
      api.updateProjectViewport('project/1', {
        canvas_viewport_x: 0,
        canvas_viewport_y: 0,
        canvas_zoom: 1,
      }),
    ).rejects.toThrow('The project response contained invalid data.');
  });

  it('rejects duplicate project records', () => {
    const savedProject = project();

    expect(isProjectsResponse([savedProject])).toBe(true);
    expect(isProjectsResponse([savedProject, savedProject])).toBe(false);
  });
});
