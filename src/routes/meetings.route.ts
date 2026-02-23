// routes/meetings.route.ts
// B1.3, B3.2: Meeting CRUD, transcript export, meeting minutes generation
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { supabase } from "../db/supabase.js";
import { exportTranscriptAsTxt } from "../services/export.service.js";
import { generateMeetingMinutes } from "../services/llm.service.js";

const CreateMeetingSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  googleMeetUrl: z.string().url().optional(),
});

export const meetingsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", authenticate);

  // POST /meetings — start a new meeting session
  fastify.post("/", async (req, reply) => {
    const body = CreateMeetingSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { data, error } = await supabase
      .from("meetings")
      .insert({
        user_id: req.user.id,
        title: body.data.title ?? "Untitled Meeting",
        google_meet_url: body.data.googleMeetUrl ?? null,
        started_at: new Date().toISOString(),
        status: "active",
      })
      .select()
      .single();

    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // GET /meetings — list user's meetings
  fastify.get("/", async (req, reply) => {
    const { data, error } = await supabase
      .from("meetings")
      .select("id, title, status, started_at, ended_at, google_meet_url")
      .eq("user_id", req.user.id)
      .order("started_at", { ascending: false })
      .limit(50);

    if (error) return reply.status(500).send({ error: error.message });
    return data;
  });

  // GET /meetings/:id — get full meeting detail
  fastify.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const { data, error } = await supabase
      .from("meetings")
      .select("*, transcript_segments(text, speaker_label, start_ms, end_ms, is_final)")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();

    if (error || !data) return reply.status(404).send({ error: "Meeting not found" });
    return data;
  });

  // PATCH /meetings/:id — update title or status
  fastify.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const body = z
      .object({ title: z.string().optional(), status: z.enum(["active", "completed"]).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });

    const { data, error } = await supabase
      .from("meetings")
      .update(body.data)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error || !data) return reply.status(404).send({ error: "Meeting not found" });
    return data;
  });

  // GET /meetings/:id/export — B1.3: download transcript as .txt
  fastify.get<{ Params: { id: string } }>("/:id/export", async (req, reply) => {
    const { data: meeting } = await supabase
      .from("meetings")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();

    if (!meeting) return reply.status(404).send({ error: "Meeting not found" });

    const buffer = await exportTranscriptAsTxt(req.params.id);
    return reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="transcript-${req.params.id}.txt"`)
      .send(buffer);
  });

  // POST /meetings/:id/minutes — B3.2: generate AI meeting minutes
  fastify.post<{ Params: { id: string } }>("/:id/minutes", async (req, reply) => {
    const { data: meeting } = await supabase
      .from("meetings")
      .select("id, status")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();

    if (!meeting) return reply.status(404).send({ error: "Meeting not found" });

    const minutes = await generateMeetingMinutes(req.params.id);

    // Persist summary + action items + decisions
    await supabase
      .from("meetings")
      .update({
        summary: minutes.summary,
        action_items: minutes.actionItems,
        decisions: minutes.decisions,
        status: "completed",
      })
      .eq("id", req.params.id);

    return minutes;
  });
};
