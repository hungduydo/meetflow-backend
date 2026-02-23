# MeetFlow AI — Backend

> Node.js/Fastify backend powering real-time transcription, AI co-pilot features, and the RAG knowledge base for the MeetFlow Chrome Extension.

---

## Architecture

```
src/
├── config/
│   └── env.ts              # Zod-validated environment config
├── db/
│   ├── supabase.ts         # Supabase client (service + anon)
│   └── migrations/
│       └── 001_initial_schema.sql   # Full schema with RLS + pgvector
├── middleware/
│   └── auth.ts             # JWT authentication hook
├── routes/
│   ├── stream.route.ts     # WS /ws/stream — audio ingestion (B1.1)
│   ├── meetings.route.ts   # REST /api/meetings — CRUD + export (B1.3)
│   ├── ai.route.ts         # REST /api/ai — Smart Reply + Magic Search (B2.2, B2.4)
│   └── documents.route.ts  # REST /api/documents — RAG uploads (B2.3)
├── services/
│   ├── stt.service.ts      # Deepgram streaming STT (B1.1, B1.2)
│   ├── llm.service.ts      # Gemini 1.5 Flash — replies, minutes, search (B2.1–B2.4, B3.2)
│   ├── rag.service.ts      # Chunk → embed → vector search (B2.3)
│   └── export.service.ts   # Transcript → .txt download (B1.3)
└── types/
    └── supabase.ts         # Generated DB types
```

## PRD Task Coverage

| Task  | Description                  | File(s)                              |
|-------|------------------------------|--------------------------------------|
| B1.1  | WebSocket Server             | `routes/stream.route.ts`, `services/stt.service.ts` |
| B1.2  | Deepgram STT Integration     | `services/stt.service.ts`            |
| B1.3  | Transcript Export (.txt)     | `services/export.service.ts`, `routes/meetings.route.ts` |
| B2.1  | Gemini 1.5 Flash Integration | `services/llm.service.ts`            |
| B2.2  | Smart Reply Engine           | `services/llm.service.ts`, `routes/ai.route.ts` |
| B2.3  | RAG Pipeline                 | `services/rag.service.ts`, `routes/documents.route.ts` |
| B2.4  | Magic Search API             | `services/llm.service.ts`, `routes/ai.route.ts` |
| B2.5  | Supabase Schema + Auth       | `db/migrations/001_initial_schema.sql`, `db/supabase.ts` |
| B3.2  | Meeting Minutes Generation   | `services/llm.service.ts`, `routes/meetings.route.ts` |

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
```

Edit `.env` and fill in these required values:

| Variable | Where to find it |
|----------|-----------------|
| `SUPABASE_URL` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API |
| `DATABASE_URL` | Supabase Dashboard → Settings → Database → Connection string (URI) |
| `DEEPGRAM_API_KEY` | console.deepgram.com |
| `GEMINI_API_KEY` | aistudio.google.com/app/apikey |
| `JWT_SECRET` | Any random string ≥ 32 chars |

```bash
# 3. Run database migrations (no Supabase CLI needed — uses pg directly)
npm run db:migrate

# Rollback all tables if needed
npm run db:rollback

# 4. Start dev server (hot-reload)
npm run dev
```

> **How migrations work:** `scripts/migrate.ts` connects directly to your Postgres DB
> via `DATABASE_URL` using the `pg` package. It tracks applied migrations in a
> `_migrations` table and is fully idempotent — safe to run multiple times.

## API Endpoints

### WebSocket
| Endpoint | Description |
|----------|-------------|
| `WS /ws/stream?meetingId=&token=` | Stream audio chunks from extension |
| `GET /ws/stream/status` | Active session count |

### Meetings
| Endpoint | Description |
|----------|-------------|
| `POST /api/meetings` | Create meeting session |
| `GET /api/meetings` | List user's meetings |
| `GET /api/meetings/:id` | Get meeting + transcript |
| `PATCH /api/meetings/:id` | Update title/status |
| `GET /api/meetings/:id/export` | Download transcript as .txt |
| `POST /api/meetings/:id/minutes` | Generate AI meeting minutes |

### AI
| Endpoint | Description |
|----------|-------------|
| `POST /api/ai/smart-reply/:meetingId` | Generate 3 reply variants |
| `PATCH /api/ai/smart-reply/:replyId/used` | Track variant usage |
| `POST /api/ai/search/:meetingId` | Cmd+K magic search |

### Documents (RAG)
| Endpoint | Description |
|----------|-------------|
| `POST /api/documents` | Upload + ingest PDF/Doc |
| `GET /api/documents` | List user's documents |
| `DELETE /api/documents/:id` | Delete document + chunks |

## KPI Targets (from PRD)
- **STT Latency**: < 2s end-to-end (`STT_TARGET_LATENCY_MS=2000`)
- **WER**: < 8% English (Deepgram nova-2 model)
- **Smart Reply**: < 1.5s response (Gemini 1.5 Flash)
- **Context Window**: Last 10–20 min of transcript per LLM call

## Running Tests
```bash
npm test
```
