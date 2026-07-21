const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface Project {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  canvas_viewport_x: number;
  canvas_viewport_y: number;
  canvas_zoom: number;
}

export type BubbleSourceKind = 'manual' | 'discussion';

export interface Bubble {
  id: string;
  project_id: string;
  title: string;
  summary: string | null;
  content: string;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
  source_kind: BubbleSourceKind;
  source_discussion_id: string | null;
  source_message_ids: string[];
}

interface ApiErrorBody {
  code?: string;
  message?: string;
}

export interface CreateProjectInput {
  title: string;
  description: string;
}

export interface UpdateProjectDescriptionInput {
  description: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, body?: ApiErrorBody) {
    super(body?.message ?? `API request failed with status ${status}.`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;

    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = undefined;
    }

    throw new ApiError(response.status, body);
  }

  return response.json() as Promise<T>;
}

export function getProjects(signal?: AbortSignal): Promise<Project[]> {
  return requestJson<Project[]>('/projects', { signal });
}

export function getProject(projectId: string, signal?: AbortSignal): Promise<Project> {
  return requestJson<Project>(`/projects/${encodeURIComponent(projectId)}`, { signal });
}

export function getProjectBubbles(
  projectId: string,
  signal?: AbortSignal,
): Promise<Bubble[]> {
  return requestJson<Bubble[]>(
    `/projects/${encodeURIComponent(projectId)}/bubbles`,
    { signal },
  );
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
