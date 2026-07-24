import type {
  BatchRepositionBubblesInput,
  Bubble,
  BubbleLink,
  BubblePlacement,
  BubblePlacementStrategy,
  BubblePositionUpdate,
  BubbleSourceKind,
  CreateBubbleInput as SharedCreateBubbleInput,
  CreateBubbleLinkInput,
  CreateProjectInput,
  PlaceBubbleInput,
  Project,
  RepositionBubbleInput,
  UpdateBubbleInput as SharedUpdateBubbleInput,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
} from '@nuee/shared-types';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export type {
  Bubble,
  BubbleLink,
  BubblePlacement,
  BubblePlacementStrategy,
  BubblePositionUpdate,
  BubbleSourceKind,
  CreateBubbleLinkInput,
  CreateProjectInput,
  Project,
  UpdateProjectDescriptionInput,
  UpdateProjectViewportInput,
};

type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;

export type CreateBubbleInput = WithRequired<
  SharedCreateBubbleInput,
  'position_x' | 'position_y'
>;
export type UpdateBubblePositionInput = RepositionBubbleInput;
export type BatchUpdateBubblePositionsInput = BatchRepositionBubblesInput;
export type UpdateBubbleInput = Required<SharedUpdateBubbleInput>;
export type BubblePlacementInput = PlaceBubbleInput;

interface ApiErrorBody {
  code?: string;
  message?: string;
}

export interface ProjectViewportUpdateOptions {
  keepalive?: boolean;
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

  if (response.status === 204) {
    return undefined as T;
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

export function getBubblePlacement(
  projectId: string,
  input: BubblePlacementInput,
): Promise<BubblePlacement> {
  return requestJson<BubblePlacement>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/placement`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function createBubble(
  projectId: string,
  input: CreateBubbleInput,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubblePosition(
  projectId: string,
  bubbleId: string,
  input: UpdateBubblePositionInput,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}/position`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubblePositions(
  projectId: string,
  input: BatchUpdateBubblePositionsInput,
): Promise<Bubble[]> {
  return requestJson<Bubble[]>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/positions`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function updateBubble(
  projectId: string,
  bubbleId: string,
  input: UpdateBubbleInput,
  signal?: AbortSignal,
): Promise<Bubble> {
  return requestJson<Bubble>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    },
  );
}

export function deleteBubble(
  projectId: string,
  bubbleId: string,
  signal?: AbortSignal,
): Promise<void> {
  return requestJson<void>(
    `/projects/${encodeURIComponent(projectId)}/bubbles/${encodeURIComponent(bubbleId)}`,
    {
      method: 'DELETE',
      signal,
    },
  );
}

export function getBubbleLinks(
  projectId: string,
  signal?: AbortSignal,
): Promise<BubbleLink[]> {
  return requestJson<BubbleLink[]>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links`,
    { signal },
  );
}

export function createBubbleLink(
  projectId: string,
  input: CreateBubbleLinkInput,
): Promise<BubbleLink> {
  return requestJson<BubbleLink>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
}

export function deleteBubbleLink(
  projectId: string,
  firstBubbleId: string,
  secondBubbleId: string,
): Promise<void> {
  return requestJson<void>(
    `/projects/${encodeURIComponent(projectId)}/bubble-links/${encodeURIComponent(firstBubbleId)}/${encodeURIComponent(secondBubbleId)}`,
    { method: 'DELETE' },
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
