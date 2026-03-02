"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestDocument = ingestDocument;
exports.searchKnowledgeBase = searchKnowledgeBase;
exports.formatRAGContext = formatRAGContext;
// services/rag.service.ts
// B2.3: Personal Knowledge Base — PDF/Doc ingestion → chunk → embed → store → search
const generative_ai_1 = require("@google/generative-ai");
const supabase_js_1 = require("../db/supabase.js");
const env_js_1 = require("../config/env.js");
const uuid_1 = require("uuid");
const genAI = new generative_ai_1.GoogleGenerativeAI(env_js_1.env.GEMINI_API_KEY);
// Gemini text-embedding-004 — 768-dim vectors
function getEmbeddingModel() {
    return genAI.getGenerativeModel({ model: "text-embedding-004" });
}
// ── Text Chunking ─────────────────────────────────────────────────────────────
function chunkText(text, chunkSize = env_js_1.env.EMBEDDING_CHUNK_SIZE, overlap = env_js_1.env.EMBEDDING_CHUNK_OVERLAP) {
    const words = text.split(/\s+/);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
        const chunk = words.slice(i, i + chunkSize).join(" ");
        if (chunk.trim())
            chunks.push(chunk);
        i += chunkSize - overlap; // sliding window with overlap
    }
    return chunks;
}
// ── Embedding Generation ──────────────────────────────────────────────────────
async function embedText(text) {
    const model = getEmbeddingModel();
    const result = await model.embedContent(text);
    return result.embedding.values;
}
async function embedBatch(texts) {
    // Gemini supports batch embedding — process in groups of 100
    const batchSize = 100;
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const embeddings = await Promise.all(batch.map(embedText));
        results.push(...embeddings);
    }
    return results;
}
// ── Document Ingestion Pipeline ───────────────────────────────────────────────
async function ingestDocument(documentId, userId, rawText) {
    // Update status to processing
    await supabase_js_1.supabase
        .from("documents")
        .update({ status: "processing" })
        .eq("id", documentId);
    try {
        const chunks = chunkText(rawText);
        const embeddings = await embedBatch(chunks);
        const rows = chunks.map((content, idx) => ({
            id: (0, uuid_1.v4)(),
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
            const { error } = await supabase_js_1.supabase
                .from("document_chunks")
                .insert(rows.slice(i, i + batchSize));
            if (error)
                throw error;
        }
        // Mark document ready + update chunk count
        await supabase_js_1.supabase
            .from("documents")
            .update({ status: "ready", chunk_count: chunks.length })
            .eq("id", documentId);
        return { chunkCount: chunks.length };
    }
    catch (err) {
        await supabase_js_1.supabase
            .from("documents")
            .update({ status: "failed" })
            .eq("id", documentId);
        throw err;
    }
}
async function searchKnowledgeBase(query, userId, matchCount = 5) {
    const queryEmbedding = await embedText(query);
    const { data, error } = await supabase_js_1.supabase.rpc("match_document_chunks", {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        user_id_filter: userId,
    });
    if (error)
        throw error;
    return (data ?? []).map((row) => ({
        content: row.content,
        similarity: row.similarity,
        documentId: row.document_id,
    }));
}
// ── Format RAG context for LLM injection ─────────────────────────────────────
function formatRAGContext(results) {
    if (!results.length)
        return "";
    return results
        .filter((r) => r.similarity > 0.7) // only high-confidence matches
        .map((r, i) => `[DOC ${i + 1}] ${r.content}`)
        .join("\n\n");
}
//# sourceMappingURL=rag.service.js.map