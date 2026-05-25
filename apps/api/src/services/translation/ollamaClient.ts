import { env } from "../../config/env.js";
import { buildTranslationMessages } from "./prompt.js";
import { parseTranslationJson, type TranslationRequest, type TranslationResponse } from "./types.js";

interface OllamaChatResponse {
  message?: { content?: string };
  response?: string;
}

export async function translateWithOllama(
  input: TranslationRequest,
  options: { model?: string } = {}
): Promise<TranslationResponse> {
  const endpoint = new URL("/api/chat", env.OLLAMA_BASE_URL).toString();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model ?? env.OLLAMA_MODEL,
      messages: buildTranslationMessages(input),
      format: "json",
      stream: false,
      options: {
        temperature: 0.15,
        num_ctx: env.OLLAMA_NUM_CTX
      }
    }),
    signal: AbortSignal.timeout(env.OLLAMA_REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as OllamaChatResponse;
  const content = body.message?.content ?? body.response;
  if (!content) throw new Error("Ollama response did not include message content");
  return parseTranslationJson(content);
}
