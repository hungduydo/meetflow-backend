// index.ts — Fastify server bootstrap
// B1.1, B1.5: Server setup with WebSocket, CORS, rate-limit, auth, Swagger
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./config/env.js";
import { streamRoute } from "./routes/stream.route.js";
import { meetingsRoute } from "./routes/meetings.route.js";
import { aiRoute } from "./routes/ai.route.js";
import { documentsRoute } from "./routes/documents.route.js";
import { recordingsRoute } from "./routes/recordings.route.js";

async function build() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "warn" : "info",
      ...(env.NODE_ENV !== "production" && {
        transport: { target: "pino-pretty", options: { colorize: true } },
      }),
    },
    maxParamLength: 200,
  });

  // ── Plugins ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.NODE_ENV === "production"
      ? ["chrome-extension://*"]  // allow only the MeetFlow extension
      : true,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () => ({
      error: "Too many requests",
      retryAfter: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
    }),
  });

  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — B2.3
  });

  await app.register(websocket, {
    options: {
      maxPayload: env.WS_MAX_PAYLOAD_BYTES,
    },
  });

  // ── OpenAPI docs ─────────────────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: "MeetFlow AI API",
        description: "Backend API for MeetFlow AI Chrome Extension",
        version: "1.0.0",
      },
      tags: [
        { name: "meetings", description: "Meeting management & export" },
        { name: "ai", description: "Smart Reply & Magic Search" },
        { name: "documents", description: "RAG knowledge base" },
        { name: "stream", description: "Real-time audio streaming" },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
  });

  // ── Routes ───────────────────────────────────────────────────────────────────
  await app.register(streamRoute, { prefix: "/ws" });
  await app.register(meetingsRoute, { prefix: "/api/meetings" });
  await app.register(aiRoute, { prefix: "/api/ai" });
  await app.register(documentsRoute, { prefix: "/api/documents" });
  await app.register(recordingsRoute, { prefix: "/api/recordings" });

  // ── Health check ─────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  }));

  // ── Global error handler ──────────────────────────────────────────────────────
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const statusCode = err.statusCode ?? 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : err.message,
      ...(env.NODE_ENV !== "production" && { stack: err.stack }),
    });
  });

  return app;
}

async function start() {
  const app = await build();

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`🚀 MeetFlow backend running on http://${env.HOST}:${env.PORT}`);
    app.log.info(`📖 API docs at http://${env.HOST}:${env.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      app.log.info(`Received ${signal}, shutting down…`);
      await app.close();
      process.exit(0);
    });
  }
}

start();
