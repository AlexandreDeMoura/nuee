import type {
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from '@nuee/shared-types';
import { requestJson } from './client';

export type {
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
};

export interface ProjectViewportUpdateOptions {
  keepalive?: boolean;
}

export function getProjects(signal?: AbortSignal): Promise<Project[]> {
  return requestJson<Project[]>('/projects', { signal });
}

export function getProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<Project> {
  return requestJson<Project>(`/projects/${encodeURIComponent(projectId)}`, {
    signal,
  });
}

export function createProject(input: CreateProjectInput): Promise<Project> {
  return requestJson<Project>('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateProjectDescription(
  projectId: string,
  input: UpdateProjectDescriptionInput,
  signal?: AbortSignal,
): Promise<Project> {
  return requestJson<Project>(
    `/projects/${encodeURIComponent(projectId)}/description`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    },
  );
}

export function updateProjectViewport(
  projectId: string,
  input: UpdateProjectViewportInput,
  options: ProjectViewportUpdateOptions = {},
): Promise<Project> {
  return requestJson<Project>(
    `/projects/${encodeURIComponent(projectId)}/viewport`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: options.keepalive,
    },
  );
}
