// config/env.ts — B2.5: Central environment validation (Zod)
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default("0.0.0.0"),

  // Supabase — B2.5
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  // JWT
  JWT_SECRET: z.string().min(32),

  // Deepgram STT — B1.2
  DEEPGRAM_API_KEY: z.string().min(1),

  // OpenAI Whisper fallback — B1.2
  OPENAI_API_KEY: z.string().optional(),

  // Gemini LLM — B2.1
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-1.5-flash"),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),

  // WebSocket
  WS_PING_INTERVAL_MS: z.coerce.number().default(30_000),
  WS_MAX_PAYLOAD_BYTES: z.coerce.number().default(1_048_576), // 1 MB

  // STT config — B1.2
  STT_TARGET_LATENCY_MS: z.coerce.number().default(2000),
  STT_LANGUAGE: z.string().default("en-US"),

  // RAG / embeddings — B2.3
  EMBEDDING_CHUNK_SIZE: z.coerce.number().default(500),
  EMBEDDING_CHUNK_OVERLAP: z.coerce.number().default(50),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
