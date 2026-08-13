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

export type ProjectsRequest = typeof requestJson;
export type ProjectDeleteRequest = (
  projectId: string,
  signal?: AbortSignal,
) => Promise<void>;

const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 2;
const INVALID_PROJECT_MESSAGE =
  'The project response contained invalid data.';
const INVALID_PROJECTS_MESSAGE =
  'The project list response contained invalid data.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const milliseconds = Date.parse(value);

  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function isProjectResponse(
  value: unknown,
  projectId?: string,
): value is Project {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.id) &&
    (projectId === undefined || value.id === projectId) &&
    isNonEmptyString(value.title) &&
    typeof value.description === 'string' &&
    isIsoTimestamp(value.created_at) &&
    isIsoTimestamp(value.updated_at) &&
    Date.parse(value.updated_at) >= Date.parse(value.created_at) &&
    typeof value.canvas_viewport_x === 'number' &&
    Number.isFinite(value.canvas_viewport_x) &&
    typeof value.canvas_viewport_y === 'number' &&
    Number.isFinite(value.canvas_viewport_y) &&
    typeof value.canvas_zoom === 'number' &&
    Number.isFinite(value.canvas_zoom) &&
    value.canvas_zoom >= MIN_CANVAS_ZOOM &&
    value.canvas_zoom <= MAX_CANVAS_ZOOM
  );
}

export function assertProject(
  value: unknown,
  projectId?: string,
): Project {
  if (!isProjectResponse(value, projectId)) {
    throw new Error(INVALID_PROJECT_MESSAGE);
  }

  return value;
}

export function isProjectsResponse(value: unknown): value is Project[] {
  return (
    Array.isArray(value) &&
    value.every((project) => isProjectResponse(project)) &&
    new Set(value.map((project) => project.id)).size === value.length
  );
}

export function assertProjects(value: unknown): Project[] {
  if (!isProjectsResponse(value)) {
    throw new Error(INVALID_PROJECTS_MESSAGE);
  }

  return value;
}

export function createProjectsApi(request: ProjectsRequest = requestJson) {
  function getProjects(signal?: AbortSignal): Promise<Project[]> {
    return request<unknown>('/projects', { signal }).then(assertProjects);
  }

  function getProject(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<Project> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}`,
      { signal },
    ).then((response) => assertProject(response, projectId));
  }

  function createProject(input: CreateProjectInput): Promise<Project> {
    return request<unknown>('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((response) => assertProject(response));
  }

  function updateProjectDescription(
    projectId: string,
    input: UpdateProjectDescriptionInput,
    signal?: AbortSignal,
  ): Promise<Project> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/description`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      },
    ).then((response) => assertProject(response, projectId));
  }

  function updateProjectViewport(
    projectId: string,
    input: UpdateProjectViewportInput,
    options: ProjectViewportUpdateOptions = {},
  ): Promise<Project> {
    return request<unknown>(
      `/projects/${encodeURIComponent(projectId)}/viewport`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        keepalive: options.keepalive,
      },
    ).then((response) => assertProject(response, projectId));
  }

  function deleteProject(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return request<void>(`/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
      signal,
    });
  }

  return {
    createProject,
    deleteProject,
    getProject,
    getProjects,
    updateProjectDescription,
    updateProjectViewport,
  };
}

export const {
  createProject,
  deleteProject,
  getProject,
  getProjects,
  updateProjectDescription,
  updateProjectViewport,
} = createProjectsApi();
