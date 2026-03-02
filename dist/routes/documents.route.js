"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentsRoute = void 0;
const auth_js_1 = require("../middleware/auth.js");
const supabase_js_1 = require("../db/supabase.js");
const rag_service_js_1 = require("../services/rag.service.js");
const uuid_1 = require("uuid");
const ALLOWED_MIME_TYPES = [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const documentsRoute = async (fastify) => {
    fastify.addHook("onRequest", auth_js_1.authenticate);
    // POST /documents — upload + ingest a document into the knowledge base
    fastify.post("/", async (req, reply) => {
        const data = await req.file();
        if (!data)
            return reply.status(400).send({ error: "No file uploaded" });
        if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
            return reply.status(415).send({
                error: "Unsupported file type",
                allowed: ALLOWED_MIME_TYPES,
            });
        }
        const chunks = [];
        for await (const chunk of data.file)
            chunks.push(chunk);
        const fileBuffer = Buffer.concat(chunks);
        if (fileBuffer.byteLength > MAX_FILE_SIZE) {
            return reply.status(413).send({ error: "File exceeds 10 MB limit" });
        }
        const documentId = (0, uuid_1.v4)();
        const storagePath = `${req.user.id}/${documentId}/${data.filename}`;
        // Upload raw file to Supabase Storage
        const { error: uploadError } = await supabase_js_1.supabase.storage
            .from("documents")
            .upload(storagePath, fileBuffer, { contentType: data.mimetype });
        if (uploadError) {
            return reply.status(500).send({ error: "Storage upload failed", detail: uploadError.message });
        }
        // Create DB record
        const { data: doc, error: dbError } = await supabase_js_1.supabase
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
                await (0, rag_service_js_1.ingestDocument)(documentId, req.user.id, rawText);
                fastify.log.info(`[RAG] Document ingested: ${documentId} (${rawText.split(/\s+/).length} words)`);
            }
            catch (err) {
                fastify.log.error(`[RAG] Ingestion failed for ${documentId}: ${err.message}`);
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
        const { data } = await supabase_js_1.supabase
            .from("documents")
            .select("id, filename, file_size, status, chunk_count, created_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });
        return data ?? [];
    });
    // DELETE /documents/:id — remove document + all chunks
    fastify.delete("/:id", async (req, reply) => {
        const { data: doc } = await supabase_js_1.supabase
            .from("documents")
            .select("id, storage_path")
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .single();
        if (!doc)
            return reply.status(404).send({ error: "Document not found" });
        // Remove from storage
        await supabase_js_1.supabase.storage.from("documents").remove([doc.storage_path]);
        // Cascade deletes chunks via FK
        await supabase_js_1.supabase.from("documents").delete().eq("id", doc.id);
        return reply.status(204).send();
    });
};
exports.documentsRoute = documentsRoute;
//# sourceMappingURL=documents.route.js.map