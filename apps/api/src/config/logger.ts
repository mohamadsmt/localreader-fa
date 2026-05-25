import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "METIS_API_KEY",
      "req.headers.authorization",
      "headers.authorization",
      "*.apiKey",
      "*.token",
      "*.secret"
    ],
    censor: "[redacted]"
  }
});
