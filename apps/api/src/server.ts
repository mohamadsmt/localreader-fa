import { existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { ZodError } from "zod";
import { env, paths, redactedEnvSummary } from "./config/env.js";
import { logger } from "./config/logger.js";
import { connectDatabase, disconnectDatabase } from "./db.js";
import { registerApiRoutes } from "./routes/api.js";
import { WorkerLoop } from "./services/jobs/worker.js";

export async function buildServer(): Promise<Fastify.FastifyInstance> {
  const app = Fastify({
    logger: {
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
    }
  });
  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/]
  });
  app.addContentTypeParser("text/xml", { parseAs: "string" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/xml", { parseAs: "string" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_request, body, done) => done(null, body));

  await registerApiRoutes(app);

  await app.register(staticPlugin, {
    root: paths.mediaRoot,
    prefix: "/media/",
    decorateReply: false
  });

  if (existsSync(paths.webDist)) {
    await app.register(staticPlugin, {
      root: paths.webDist,
      prefix: "/"
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.code(404).send({ error: "Not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      reply.code(400).send({ error: "Validation failed", issues: error.issues });
      return;
    }
    const normalized = error instanceof Error ? error : new Error(String(error));
    const statusCode =
      typeof (normalized as Error & { statusCode?: unknown }).statusCode === "number"
        ? (normalized as Error & { statusCode: number }).statusCode
        : 500;
    logger.error({ error: normalized }, "request failed");
    reply.code(statusCode).send({ error: statusCode >= 500 ? "Internal server error" : normalized.message });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = new WorkerLoop();
  const app = await buildServer();
  await connectDatabase();
  worker.start();
  logger.info(redactedEnvSummary(), "starting LocalReader FA");
  await app.listen({ port: env.APP_PORT, host: "0.0.0.0" });

  const shutdown = async () => {
    worker.stop();
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
