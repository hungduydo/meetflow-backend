"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingsRoute = void 0;
const zod_1 = require("zod");
const auth_js_1 = require("../middleware/auth.js");
const supabase_js_1 = require("../db/supabase.js");
const export_service_js_1 = require("../services/export.service.js");
const llm_service_js_1 = require("../services/llm.service.js");
const CreateMeetingSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200).optional(),
    googleMeetUrl: zod_1.z.string().url().optional(),
});
const meetingsRoute = async (fastify) => {
    fastify.addHook("onRequest", auth_js_1.authenticate);
    // POST /meetings — start a new meeting session
    fastify.post("/", async (req, reply) => {
        const body = CreateMeetingSchema.safeParse(req.body);
        if (!body.success)
            return reply.status(400).send({ error: body.error.flatten() });
        const { data, error } = await supabase_js_1.supabase
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
        if (error)
            return reply.status(500).send({ error: error.message });
        return reply.status(201).send(data);
    });
    // GET /meetings — list user's meetings
    fastify.get("/", async (req, reply) => {
        const { data, error } = await supabase_js_1.supabase
            .from("meetings")
            .select("id, title, status, started_at, ended_at, google_meet_url")
            .eq("user_id", req.user.id)
            .order("started_at", { ascending: false })
            .limit(50);
        if (error)
            return reply.status(500).send({ error: error.message });
        return data;
    });
    // GET /meetings/:id — get full meeting detail
    fastify.get("/:id", async (req, reply) => {
        const { data, error } = await supabase_js_1.supabase
            .from("meetings")
            .select("*, transcript_segments(text, speaker_label, start_ms, end_ms, is_final)")
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .single();
        if (error || !data)
            return reply.status(404).send({ error: "Meeting not found" });
        return data;
    });
    // PATCH /meetings/:id — update title or status
    fastify.patch("/:id", async (req, reply) => {
        const body = zod_1.z
            .object({ title: zod_1.z.string().optional(), status: zod_1.z.enum(["active", "completed"]).optional() })
            .safeParse(req.body);
        if (!body.success)
            return reply.status(400).send({ error: body.error.flatten() });
        const { data, error } = await supabase_js_1.supabase
            .from("meetings")
            .update(body.data)
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .select()
            .single();
        if (error || !data)
            return reply.status(404).send({ error: "Meeting not found" });
        return data;
    });
    // GET /meetings/:id/export — B1.3: download transcript as .txt
    fastify.get("/:id/export", async (req, reply) => {
        const { data: meeting } = await supabase_js_1.supabase
            .from("meetings")
            .select("id")
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .single();
        if (!meeting)
            return reply.status(404).send({ error: "Meeting not found" });
        const buffer = await (0, export_service_js_1.exportTranscriptAsTxt)(req.params.id);
        return reply
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Content-Disposition", `attachment; filename="transcript-${req.params.id}.txt"`)
            .send(buffer);
    });
    // POST /meetings/:id/minutes — B3.2: generate AI meeting minutes
    fastify.post("/:id/minutes", async (req, reply) => {
        const { data: meeting } = await supabase_js_1.supabase
            .from("meetings")
            .select("id, status")
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .single();
        if (!meeting)
            return reply.status(404).send({ error: "Meeting not found" });
        const minutes = await (0, llm_service_js_1.generateMeetingMinutes)(req.params.id);
        // Persist summary + action items + decisions
        await supabase_js_1.supabase
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
exports.meetingsRoute = meetingsRoute;
//# sourceMappingURL=meetings.route.js.map