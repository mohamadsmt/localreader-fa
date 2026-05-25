export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function downloadUrl(path: string): void {
  window.open(path, "_blank", "noopener,noreferrer");
}
