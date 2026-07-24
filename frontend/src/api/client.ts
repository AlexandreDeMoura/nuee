interface ApiErrorBody {
  code?: string;
  message?: string;
}

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

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

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
