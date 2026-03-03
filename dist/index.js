"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// index.ts — Fastify server bootstrap
// B1.1, B1.5: Server setup with WebSocket, CORS, rate-limit, auth, Swagger
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const swagger_1 = __importDefault(require("@fastify/swagger"));
const swagger_ui_1 = __importDefault(require("@fastify/swagger-ui"));
const env_js_1 = require("./config/env.js");
const stream_route_js_1 = require("./routes/stream.route.js");
const meetings_route_js_1 = require("./routes/meetings.route.js");
const ai_route_js_1 = require("./routes/ai.route.js");
const documents_route_js_1 = require("./routes/documents.route.js");
const recordings_route_js_1 = require("./routes/recordings.route.js");
async function build() {
    const app = (0, fastify_1.default)({
        logger: {
            level: env_js_1.env.NODE_ENV === "production" ? "warn" : "info",
            ...(env_js_1.env.NODE_ENV !== "production" && {
                transport: { target: "pino-pretty", options: { colorize: true } },
            }),
        },
        maxParamLength: 200,
    });
    // ── Plugins ──────────────────────────────────────────────────────────────────
    await app.register(cors_1.default, {
        origin: env_js_1.env.NODE_ENV === "production"
            ? ["chrome-extension://*"] // allow only the MeetFlow extension
            : true,
        methods: ["GET", "POST", "PATCH", "DELETE"],
    });
    await app.register(rate_limit_1.default, {
        max: env_js_1.env.RATE_LIMIT_MAX,
        timeWindow: env_js_1.env.RATE_LIMIT_WINDOW_MS,
        errorResponseBuilder: () => ({
            error: "Too many requests",
            retryAfter: Math.ceil(env_js_1.env.RATE_LIMIT_WINDOW_MS / 1000),
        }),
    });
    await app.register(multipart_1.default, {
        limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB — B2.3
    });
    await app.register(websocket_1.default, {
        options: {
            maxPayload: env_js_1.env.WS_MAX_PAYLOAD_BYTES,
        },
    });
    // ── OpenAPI docs ─────────────────────────────────────────────────────────────
    await app.register(swagger_1.default, {
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
    await app.register(swagger_ui_1.default, {
        routePrefix: "/docs",
        uiConfig: { docExpansion: "list" },
    });
    // ── Routes ───────────────────────────────────────────────────────────────────
    await app.register(stream_route_js_1.streamRoute, { prefix: "/ws" });
    await app.register(meetings_route_js_1.meetingsRoute, { prefix: "/api/meetings" });
    await app.register(ai_route_js_1.aiRoute, { prefix: "/api/ai" });
    await app.register(documents_route_js_1.documentsRoute, { prefix: "/api/documents" });
    await app.register(recordings_route_js_1.recordingsRoute, { prefix: "/api/recordings" });
    // ── Health check ─────────────────────────────────────────────────────────────
    app.get("/health", async () => ({
        status: "ok",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        env: env_js_1.env.NODE_ENV,
    }));
    // ── Global error handler ──────────────────────────────────────────────────────
    app.setErrorHandler((err, _req, reply) => {
        app.log.error(err);
        const statusCode = err.statusCode ?? 500;
        reply.status(statusCode).send({
            error: statusCode >= 500 ? "Internal Server Error" : err.message,
            ...(env_js_1.env.NODE_ENV !== "production" && { stack: err.stack }),
        });
    });
    return app;
}
async function start() {
    const app = await build();
    try {
        await app.listen({ port: env_js_1.env.PORT, host: env_js_1.env.HOST });
        app.log.info(`🚀 MeetFlow backend running on http://${env_js_1.env.HOST}:${env_js_1.env.PORT}`);
        app.log.info(`📖 API docs at http://${env_js_1.env.HOST}:${env_js_1.env.PORT}/docs`);
    }
    catch (err) {
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
//# sourceMappingURL=index.js.map