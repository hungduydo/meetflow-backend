-- migrations/001_initial_schema.sql
-- B2.5: Core schema with RLS, pgvector, and indexes
-- Run via: supabase db push

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Users ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_data" ON users
  USING (id = auth.uid());

-- ── Meetings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Untitled Meeting',
  google_meet_url  TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'processing')),
  raw_transcript   TEXT,
  summary          TEXT,
  action_items     JSONB,
  decisions        JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meetings_user_id ON meetings(user_id);
CREATE INDEX idx_meetings_status  ON meetings(status);
CREATE INDEX idx_meetings_started ON meetings(started_at DESC);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meetings_own_data" ON meetings
  USING (user_id = auth.uid());

-- ── Transcript Segments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcript_segments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id    TEXT,
  speaker_label TEXT,
  text          TEXT NOT NULL,
  confidence    REAL,
  start_ms      INTEGER NOT NULL,
  end_ms        INTEGER NOT NULL,
  is_final      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_segments_meeting_id ON transcript_segments(meeting_id);
CREATE INDEX idx_segments_start_ms   ON transcript_segments(meeting_id, start_ms);

ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "segments_via_meeting" ON transcript_segments
  USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = transcript_segments.meeting_id
        AND m.user_id = auth.uid()
    )
  );

-- Full-text search function for Magic Search (B2.4)
CREATE OR REPLACE FUNCTION search_transcript_segments(
  meeting_id_filter UUID,
  query TEXT,
  limit_count INT DEFAULT 5
)
RETURNS TABLE (id UUID, text TEXT, speaker_label TEXT, start_ms INT) AS $$
  SELECT id, text, speaker_label, start_ms
  FROM transcript_segments
  WHERE meeting_id = meeting_id_filter
    AND is_final = TRUE
    AND to_tsvector('english', text) @@ plainto_tsquery('english', query)
  ORDER BY start_ms
  LIMIT limit_count;
$$ LANGUAGE sql STABLE;

-- ── Documents (RAG) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  mime_type    TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  chunk_count  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_status  ON documents(status);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_own_data" ON documents
  USING (user_id = auth.uid());

-- ── Document Chunks + Embeddings (B2.3) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding   VECTOR(768),  -- Gemini text-embedding-004 dimension
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chunks_document_id ON document_chunks(document_id);
CREATE INDEX idx_chunks_user_id     ON document_chunks(user_id);
-- IVFFlat index for fast approximate nearest-neighbour search
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chunks_own_data" ON document_chunks
  USING (user_id = auth.uid());

-- Vector similarity search function for RAG (B2.3, B2.4)
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding VECTOR(768),
  match_count     INT DEFAULT 5,
  user_id_filter  UUID DEFAULT NULL
)
RETURNS TABLE (id UUID, content TEXT, similarity FLOAT, document_id UUID) AS $$
  SELECT
    dc.id,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    dc.document_id
  FROM document_chunks dc
  WHERE (user_id_filter IS NULL OR dc.user_id = user_id_filter)
    AND dc.embedding IS NOT NULL
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- ── Smart Replies ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smart_replies (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id           UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  trigger_text         TEXT NOT NULL,
  reply_professional   TEXT NOT NULL,
  reply_casual         TEXT NOT NULL,
  reply_concise        TEXT NOT NULL,
  was_used             BOOLEAN NOT NULL DEFAULT FALSE,
  used_variant         TEXT CHECK (used_variant IN ('professional', 'casual', 'concise')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE smart_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replies_via_meeting" ON smart_replies
  USING (
    EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = smart_replies.meeting_id
        AND m.user_id = auth.uid()
    )
  );
