"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
// config/env.ts — B2.5: Central environment validation (Zod)
require("dotenv/config");
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "production", "test"]).default("development"),
    PORT: zod_1.z.coerce.number().default(3001),
    HOST: zod_1.z.string().default("0.0.0.0"),
    // Supabase — B2.5
    SUPABASE_URL: zod_1.z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string().min(1),
    SUPABASE_ANON_KEY: zod_1.z.string().min(1),
    // JWT
    JWT_SECRET: zod_1.z.string().min(32),
    // Deepgram STT — B1.2
    DEEPGRAM_API_KEY: zod_1.z.string().min(1),
    // OpenAI Whisper fallback — B1.2
    OPENAI_API_KEY: zod_1.z.string().optional(),
    // Gemini LLM — B2.1
    GEMINI_API_KEY: zod_1.z.string().min(1),
    GEMINI_MODEL: zod_1.z.string().default("gemini-1.5-flash"),
    // Rate limiting
    RATE_LIMIT_MAX: zod_1.z.coerce.number().default(100),
    RATE_LIMIT_WINDOW_MS: zod_1.z.coerce.number().default(60_000),
    // WebSocket
    WS_PING_INTERVAL_MS: zod_1.z.coerce.number().default(30_000),
    WS_MAX_PAYLOAD_BYTES: zod_1.z.coerce.number().default(1_048_576), // 1 MB
    // STT config — B1.2
    STT_TARGET_LATENCY_MS: zod_1.z.coerce.number().default(2000),
    STT_LANGUAGE: zod_1.z.string().default("en-US"),
    // RAG / embeddings — B2.3
    EMBEDDING_CHUNK_SIZE: zod_1.z.coerce.number().default(500),
    EMBEDDING_CHUNK_OVERLAP: zod_1.z.coerce.number().default(50),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}
exports.env = parsed.data;
//# sourceMappingURL=env.js.map