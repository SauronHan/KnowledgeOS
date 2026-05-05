
export const API_BASE_URL = "http://localhost:8080/api/v1";

/**
 * Get the current auth token from storage.
 */
export function getAuthToken(): string | null {
  return localStorage.getItem("kos_auth_token");
}

/**
 * Get the current project's server-side ID.
 * Injected into all API requests via X-Project-Id header.
 */
export function getProjectServerId(): string | null {
  return localStorage.getItem("kos_project_server_id");
}

export function setProjectServerId(id: number | string | null): void {
  if (id === null) {
    localStorage.removeItem("kos_project_server_id");
  } else {
    localStorage.setItem("kos_project_server_id", String(id));
  }
}

/**
 * Standard fetch wrapper for KnowledgeOS Backend.
 * Automatically injects JWT token and project ID.
 */
export async function kosFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Inject project ID for project-scoped APIs
  const projectId = getProjectServerId();
  if (projectId && !headers.has("X-Project-Id")) {
    headers.set("X-Project-Id", projectId);
  }

  // Default to JSON if not specified
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    console.warn("Unauthorized access detected. Redirecting to login...");
    localStorage.removeItem("kos_auth_token");
    localStorage.removeItem("kos_user");
    if (typeof window !== "undefined") {
      window.location.href = "/login"; 
    }
  }

  return response;
}

/**
 * Convenience helper for JSON requests
 */
export async function kosApiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await kosFetch(endpoint, options);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(errorData.detail || "API request failed");
  }

  return response.json();
}

/**
 * SaaS Proxy for reading files from the user's isolated storage.
 */
export async function kosReadFile(path: string): Promise<string> {
  const data = await kosApiRequest<{ content: string }>(`/files/read?path=${encodeURIComponent(path)}`);
  return data.content;
}

/**
 * Sync a project to the backend. Returns the server-side project ID.
 */
export async function syncProjectToServer(uuid: string, name: string): Promise<number> {
  const data = await kosApiRequest<{ project_id: number }>("/projects", {
    method: "POST",
    body: JSON.stringify({ uuid, name }),
  });
  setProjectServerId(data.project_id);
  return data.project_id;
}
