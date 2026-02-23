-- migrations/rollback.sql
-- Drops all MeetFlow tables in dependency order (FK safe)
-- Usage: npm run db:migrate -- --rollback

DROP TABLE IF EXISTS smart_replies        CASCADE;
DROP TABLE IF EXISTS document_chunks      CASCADE;
DROP TABLE IF EXISTS documents            CASCADE;
DROP TABLE IF EXISTS transcript_segments  CASCADE;
DROP TABLE IF EXISTS meetings             CASCADE;
DROP TABLE IF EXISTS users                CASCADE;
DROP TABLE IF EXISTS _migrations          CASCADE;

-- Drop custom functions
DROP FUNCTION IF EXISTS match_document_chunks;
DROP FUNCTION IF EXISTS search_transcript_segments;

-- Optionally drop pgvector (only if no other project uses it)
-- DROP EXTENSION IF EXISTS vector;
