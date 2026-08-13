import { describe, expect, it, vi } from 'vitest';
import { createProjectsApi, type ProjectsRequest } from './projects';

describe('projects deletion API', () => {
  it('deletes a project over an escaped path and forwards the abort signal', async () => {
    const requestSpy = vi.fn();
    const request: ProjectsRequest = async <T>(
      path: string,
      init?: RequestInit,
    ) => {
      requestSpy(path, init);
      // A 204 resolves to undefined through the shared client.
      return undefined as T;
    };
    const api = createProjectsApi(request);
    const controller = new AbortController();

    await expect(
      api.deleteProject('project/one', controller.signal),
    ).resolves.toBeUndefined();
    expect(requestSpy).toHaveBeenCalledWith('/projects/project%2Fone', {
      method: 'DELETE',
      signal: controller.signal,
    });
  });

  it('surfaces a failed deletion to the caller', async () => {
    const request: ProjectsRequest = () =>
      Promise.reject(new Error('offline'));
    const api = createProjectsApi(request);

    await expect(api.deleteProject('project-one')).rejects.toThrow('offline');
  });
});
