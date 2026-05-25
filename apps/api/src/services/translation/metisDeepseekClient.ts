import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { env } from "../../config/env.js";
import { buildTranslationMessages } from "./prompt.js";
import { parseTranslationJson, type TranslationRequest, type TranslationResponse } from "./types.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function translateWithMetisDeepSeek(
  input: TranslationRequest,
  options: { model?: string } = {}
): Promise<TranslationResponse> {
  if (!env.METIS_API_KEY) throw new Error("METIS_API_KEY is not configured");
  const endpoint = `${env.METIS_DEEPSEEK_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  const messages = buildTranslationMessages(input);

  const model = options.model ?? env.METIS_DEEPSEEK_MODEL;
  const response = await postJsonWithRetry(endpoint, {
    timeoutMs: 120000,
    retries: 1,
    headers: {
      authorization: `Bearer ${env.METIS_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.35,
      ...(model.startsWith("deepseek-v4") ? { thinking: { type: "disabled" } } : {}),
      stream: false
    })
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Metis DeepSeek request failed: HTTP ${response.status} ${response.body.slice(0, 300)}`);
  }
  const body = JSON.parse(response.body) as ChatResponse;
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Metis DeepSeek response did not include message content");
  return parseTranslationJson(content);
}

async function postJsonWithRetry(
  endpoint: string,
  options: { timeoutMs: number; retries: number; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      return await postJson(endpoint, options);
    } catch (error) {
      lastError = error;
      if (attempt < options.retries) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Metis DeepSeek request failed");
}

function postJson(
  endpoint: string,
  options: { timeoutMs: number; headers: Record<string, string>; body: string }
): Promise<{ status: number; body: string }> {
  const url = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...options.headers,
          "content-length": Buffer.byteLength(options.body)
        },
        timeout: options.timeoutMs
      },
      (response) => {
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body });
        });
      }
    );
    request.on("timeout", () => {
      request.destroy(new Error(`Metis DeepSeek request timed out after ${options.timeoutMs}ms`));
    });
    request.on("error", reject);
    request.write(options.body);
    request.end();
  });
}

export { parseTranslationJson };
