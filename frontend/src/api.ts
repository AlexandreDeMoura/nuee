const API_URL = import.meta.env.VITE_API_URL;

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<HealthResponse>;
}