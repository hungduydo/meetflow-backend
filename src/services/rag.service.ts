// services/rag.service.ts
// B2.3: Personal Knowledge Base — PDF/Doc ingestion → chunk → embed → store → search
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "../db/supabase.js";
import { env } from "../config/env.js";
import { v4 as uuid } from "uuid";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Gemini text-embedding-004 — 768-dim vectors
function getEmbeddingModel() {
  return genAI.getGenerativeModel({ model: "text-embedding-004" });
}

// ── Text Chunking ─────────────────────────────────────────────────────────────
function chunkText(
  text: string,
  chunkSize: number = env.EMBEDDING_CHUNK_SIZE,
  overlap: number = env.EMBEDDING_CHUNK_OVERLAP
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim()) chunks.push(chunk);
    i += chunkSize - overlap; // sliding window with overlap
  }

  return chunks;
}

// ── Embedding Generation ──────────────────────────────────────────────────────
async function embedText(text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  // Gemini supports batch embedding — process in groups of 100
  const batchSize = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await Promise.all(batch.map(embedText));
    results.push(...embeddings);
  }

  return results;
}

// ── Document Ingestion Pipeline ───────────────────────────────────────────────
export async function ingestDocument(
  documentId: string,
  userId: string,
  rawText: string
): Promise<{ chunkCount: number }> {
  // Update status to processing
  await supabase
    .from("documents")
    .update({ status: "processing" })
    .eq("id", documentId);

  try {
    const chunks = chunkText(rawText);
    const embeddings = await embedBatch(chunks);

    const rows = chunks.map((content, idx) => ({
      id: uuid(),
      document_id: documentId,
      user_id: userId,
      content,
      chunk_index: idx,
      token_count: content.split(/\s+/).length,
      embedding: embeddings[idx],
    }));

    // Batch insert in groups of 50 (Supabase limit)
    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      const { error } = await supabase
        .from("document_chunks")
        .insert(rows.slice(i, i + batchSize));
      if (error) throw error;
    }

    // Mark document ready + update chunk count
    await supabase
      .from("documents")
      .update({ status: "ready", chunk_count: chunks.length })
      .eq("id", documentId);

    return { chunkCount: chunks.length };
  } catch (err) {
    await supabase
      .from("documents")
      .update({ status: "failed" })
      .eq("id", documentId);
    throw err;
  }
}

// ── Vector Similarity Search ──────────────────────────────────────────────────
export interface RAGResult {
  content: string;
  similarity: number;
  documentId: string;
}

export async function searchKnowledgeBase(
  query: string,
  userId: string,
  matchCount: number = 5
): Promise<RAGResult[]> {
  const queryEmbedding = await embedText(query);

  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    user_id_filter: userId,
  });

  if (error) throw error;

  return (data ?? []).map((row: { content: string; similarity: number; document_id: string }) => ({
    content: row.content,
    similarity: row.similarity,
    documentId: row.document_id,
  }));
}

// ── Format RAG context for LLM injection ─────────────────────────────────────
export function formatRAGContext(results: RAGResult[]): string {
  if (!results.length) return "";

  return results
    .filter((r) => r.similarity > 0.7) // only high-confidence matches
    .map((r, i) => `[DOC ${i + 1}] ${r.content}`)
    .join("\n\n");
}
