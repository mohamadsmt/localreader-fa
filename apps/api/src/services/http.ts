import { env } from "../config/env.js";

export interface FetchWithRetryOptions {
  timeoutMs: number;
  retries?: number;
  headers?: HeadersInit;
  method?: string;
  body?: BodyInit;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export async function fetchWithRetry(url: string, options: FetchWithRetryOptions): Promise<Response> {
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: {
          "user-agent": env.LOCALREADER_USER_AGENT,
          accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml, text/html;q=0.9, */*;q=0.8",
          ...options.headers
        },
        body: options.body,
        signal: controller.signal
      });
      if (response.status >= 500 && attempt < retries) {
        lastError = new HttpError(`HTTP ${response.status}`, response.status);
        await delay(300 * 2 ** attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(300 * 2 ** attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
