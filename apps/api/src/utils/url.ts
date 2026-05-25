import { createHash } from "node:crypto";

const trackerParams = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ref"
]);

export function normalizeUrl(input: string, base?: string): string {
  const url = new URL(input, base);
  url.hash = "";
  for (const param of [...url.searchParams.keys()]) {
    if (trackerParams.has(param.toLowerCase()) || param.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(param);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function hashUrl(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeUrl(input: string | null | undefined, base?: string): string | null {
  if (!input) return null;
  try {
    return normalizeUrl(input, base);
  } catch {
    return null;
  }
}
