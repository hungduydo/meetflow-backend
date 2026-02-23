// routes/ai.route.ts
// B2.2: Smart Reply endpoint
// B2.4: Magic Search (Cmd+K) endpoint
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";
import { generateSmartReplies, magicSearch } from "../services/llm.service.js";
import { searchKnowledgeBase, formatRAGContext } from "../services/rag.service.js";

export const aiRoute: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", authenticate);

  // POST /ai/smart-reply — B2.2: generate 3 reply variants for a detected question
  fastify.post<{ Params: { meetingId: string } }>(
    "/smart-reply/:meetingId",
    async (req, reply) => {
      const body = z
        .object({ triggerText: z.string().min(1).max(1000) })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      // Verify meeting ownership
      const { data: meeting } = await supabase
        .from("meetings")
        .select("id")
        .eq("id", req.params.meetingId)
        .eq("user_id", req.user.id)
        .single();
      if (!meeting) return reply.status(404).send({ error: "Meeting not found" });

      // Augment with RAG context if user has documents
      const ragResults = await searchKnowledgeBase(body.data.triggerText, req.user.id, 3);
      const ragContext = formatRAGContext(ragResults);

      const replies = await generateSmartReplies(
        req.params.meetingId,
        body.data.triggerText,
        ragContext
      );

      // Persist for analytics (was_used tracked separately)
      const { data: saved } = await supabase
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
    }
  );

  // PATCH /ai/smart-reply/:replyId/used — track which variant was selected
  fastify.patch<{ Params: { replyId: string } }>(
    "/smart-reply/:replyId/used",
    async (req, reply) => {
      const body = z
        .object({ variant: z.enum(["professional", "casual", "concise"]) })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      await supabase
        .from("smart_replies")
        .update({ was_used: true, used_variant: body.data.variant })
        .eq("id", req.params.replyId);

      return { ok: true };
    }
  );

  // POST /ai/search/:meetingId — B2.4: Cmd+K Magic Search
  fastify.post<{ Params: { meetingId: string } }>(
    "/search/:meetingId",
    async (req, reply) => {
      const body = z
        .object({ query: z.string().min(1).max(500) })
        .safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

      const { data: meeting } = await supabase
        .from("meetings")
        .select("id")
        .eq("id", req.params.meetingId)
        .eq("user_id", req.user.id)
        .single();
      if (!meeting) return reply.status(404).send({ error: "Meeting not found" });

      // Run LLM search + vector KB search in parallel
      const [transcriptResult, ragResults] = await Promise.all([
        magicSearch(req.params.meetingId, body.data.query),
        searchKnowledgeBase(body.data.query, req.user.id, 3),
      ]);

      return {
        transcript: transcriptResult,
        documents: ragResults.filter((r) => r.similarity > 0.7).slice(0, 3),
      };
    }
  );
};
