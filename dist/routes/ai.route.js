"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRoute = void 0;
const zod_1 = require("zod");
const auth_js_1 = require("../middleware/auth.js");
const supabase_js_1 = require("../db/supabase.js");
const llm_service_js_1 = require("../services/llm.service.js");
const rag_service_js_1 = require("../services/rag.service.js");
const aiRoute = async (fastify) => {
    fastify.addHook("onRequest", auth_js_1.authenticate);
    // POST /ai/smart-reply — B2.2: generate 3 reply variants for a detected question
    fastify.post("/smart-reply/:meetingId", async (req, reply) => {
        const body = zod_1.z
            .object({ triggerText: zod_1.z.string().min(1).max(1000) })
            .safeParse(req.body);
        if (!body.success)
            return reply.status(400).send({ error: body.error.flatten() });
        // Verify meeting ownership
        const { data: meeting } = await supabase_js_1.supabase
            .from("meetings")
            .select("id")
            .eq("id", req.params.meetingId)
            .eq("user_id", req.user.id)
            .single();
        if (!meeting)
            return reply.status(404).send({ error: "Meeting not found" });
        // Augment with RAG context if user has documents
        const ragResults = await (0, rag_service_js_1.searchKnowledgeBase)(body.data.triggerText, req.user.id, 3);
        const ragContext = (0, rag_service_js_1.formatRAGContext)(ragResults);
        const replies = await (0, llm_service_js_1.generateSmartReplies)(req.params.meetingId, body.data.triggerText, ragContext);
        // Persist for analytics (was_used tracked separately)
        const { data: saved } = await supabase_js_1.supabase
            .from("smart_replies")
            .insert({
            meeting_id: req.params.meetingId,
            trigger_text: body.data.triggerText,
            reply_professional: replies.professional,
            reply_casual: replies.casual,
            reply_concise: replies.concise,
        })
            .select("id")
            .single();
        return { replyId: saved?.id, ...replies };
    });
    // PATCH /ai/smart-reply/:replyId/used — track which variant was selected
    fastify.patch("/smart-reply/:replyId/used", async (req, reply) => {
        const body = zod_1.z
            .object({ variant: zod_1.z.enum(["professional", "casual", "concise"]) })
            .safeParse(req.body);
        if (!body.success)
            return reply.status(400).send({ error: body.error.flatten() });
        await supabase_js_1.supabase
            .from("smart_replies")
            .update({ was_used: true, used_variant: body.data.variant })
            .eq("id", req.params.replyId);
        return { ok: true };
    });
    // POST /ai/search/:meetingId — B2.4: Cmd+K Magic Search
    fastify.post("/search/:meetingId", async (req, reply) => {
        const body = zod_1.z
            .object({ query: zod_1.z.string().min(1).max(500) })
            .safeParse(req.body);
        if (!body.success)
            return reply.status(400).send({ error: body.error.flatten() });
        const { data: meeting } = await supabase_js_1.supabase
            .from("meetings")
            .select("id")
            .eq("id", req.params.meetingId)
            .eq("user_id", req.user.id)
            .single();
        if (!meeting)
            return reply.status(404).send({ error: "Meeting not found" });
        // Run LLM search + vector KB search in parallel
        const [transcriptResult, ragResults] = await Promise.all([
            (0, llm_service_js_1.magicSearch)(req.params.meetingId, body.data.query),
            (0, rag_service_js_1.searchKnowledgeBase)(body.data.query, req.user.id, 3),
        ]);
        return {
            transcript: transcriptResult,
            documents: ragResults.filter((r) => r.similarity > 0.7).slice(0, 3),
        };
    });
};
exports.aiRoute = aiRoute;
//# sourceMappingURL=ai.route.js.map