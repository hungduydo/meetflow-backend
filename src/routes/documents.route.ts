// routes/documents.route.ts
// B2.3: Document upload, ingestion into vector store, and management
import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";
import { ingestDocument } from "../services/rag.service.js";
import { v4 as uuid } from "uuid";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const documentsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", authenticate);

  // POST /documents — upload + ingest a document into the knowledge base
  fastify.post("/", async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: "No file uploaded" });

    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      return reply.status(415).send({
        error: "Unsupported file type",
        allowed: ALLOWED_MIME_TYPES,
      });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const fileBuffer = Buffer.concat(chunks);

    if (fileBuffer.byteLength > MAX_FILE_SIZE) {
      return reply.status(413).send({ error: "File exceeds 10 MB limit" });
    }

    const documentId = uuid();
    const storagePath = `${req.user.id}/${documentId}/${data.filename}`;

    // Upload raw file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, fileBuffer, { contentType: data.mimetype });

    if (uploadError) {
      return reply.status(500).send({ error: "Storage upload failed", detail: uploadError.message });
    }

    // Create DB record
    const { data: doc, error: dbError } = await supabase
      .from("documents")
      .insert({
        id: documentId,
        user_id: req.user.id,
        filename: data.filename,
        file_size: fileBuffer.byteLength,
        mime_type: data.mimetype,
        storage_path: storagePath,
        chunk_count: 0,
        status: "pending",
      })
      .select()
      .single();

    if (dbError || !doc) {
      return reply.status(500).send({ error: "Failed to create document record" });
    }

    // Extract text (basic — production should use a PDF parser like pdf-parse)
    const rawText = fileBuffer.toString("utf-8");

    // Kick off ingestion asynchronously so we can respond immediately
    setImmediate(async () => {
      try {
        await ingestDocument(documentId, req.user.id, rawText);
        fastify.log.info(`[RAG] Document ingested: ${documentId} (${rawText.split(/\s+/).length} words)`);
      } catch (err) {
        fastify.log.error(`[RAG] Ingestion failed for ${documentId}: ${(err as Error).message}`);
      }
    });

    return reply.status(202).send({
      id: documentId,
      filename: data.filename,
      status: "processing",
      message: "Document accepted. Embedding in progress.",
    });
  });

  // GET /documents — list user's documents
  fastify.get("/", async (req) => {
    const { data } = await supabase
      .from("documents")
      .select("id, filename, file_size, status, chunk_count, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    return data ?? [];
  });

  // DELETE /documents/:id — remove document + all chunks
  fastify.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { data: doc } = await supabase
      .from("documents")
      .select("id, storage_path")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();

    if (!doc) return reply.status(404).send({ error: "Document not found" });

    // Remove from storage
    await supabase.storage.from("documents").remove([doc.storage_path]);

    // Cascade deletes chunks via FK
    await supabase.from("documents").delete().eq("id", doc.id);

    return reply.status(204).send();
  });
};
