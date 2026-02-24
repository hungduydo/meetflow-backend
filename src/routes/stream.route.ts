// routes/stream.route.ts
// B1.1: Full-duplex WebSocket endpoint for audio streaming from Chrome extension
import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { z } from "zod";
import {
  openSTTSession,
  sendAudioChunk,
  closeSTTSession,
  getActiveSessionCount,
} from "../services/stt.service.js";
import { supabase } from "../db/supabase.js";

const QuerySchema = z.object({
  meetingId: z.string().uuid(),
  token: z.string().min(1), // JWT passed in query for WS (can't set headers in browser WS)
});

export const streamRoute: FastifyPluginAsync = async (fastify) => {
  // B1.1: WebSocket audio stream endpoint
  fastify.get(
    "/stream",
    { websocket: true },
    async (socket: WebSocket, req) => {
      // Parse + validate query params
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid query params" }));
        socket.close(1008, "Bad request");
        return;
      }

      const { meetingId, token } = parsed.data;

      // Authenticate via Supabase JWT
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        socket.close(1008, "Unauthorized");
        return;
      }

      // Verify user owns this meeting
      const { data: meeting } = await supabase
        .from("meetings")
        .select("id, status")
        .eq("id", meetingId)
        .eq("user_id", user.id)
        .single();

      if (!meeting) {
        socket.send(JSON.stringify({ type: "error", message: "Meeting not found" }));
        socket.close(1008, "Not found");
        return;
      }

      try {
        await openSTTSession(meetingId, socket);
        socket.send(JSON.stringify({ type: "connected", meetingId }));
        fastify.log.info(`[WS] STT session opened: meeting=${meetingId} user=${user.id}`);
      } catch (err) {
        socket.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        socket.close(1011, "Session error");
        return;
      }

      // FIX 4: @fastify/websocket passes all messages as Buffer regardless of
      // the isBinary flag. Detect binary vs text by checking if it's valid JSON
      // instead of trusting isBinary, which is unreliable across ws versions.
      socket.on("message", (data: Buffer) => {
        // Try to parse as JSON control message first
        // Binary audio frames are never valid JSON
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "end") {
            socket.close(1000, "Stream ended");
          }
          return; // was a text/control frame — don't forward to Deepgram
        } catch {
          // Not JSON → it's a binary audio chunk, forward to Deepgram
        }

        try {
          sendAudioChunk(meetingId, data);
        } catch (err) {
          fastify.log.error(`[WS] Audio chunk error: ${(err as Error).message}`);
        }
      });

      socket.on("close", async () => {
        await closeSTTSession(meetingId);
        fastify.log.info(`[WS] Session closed: meeting=${meetingId}`);
      });

      socket.on("error", (err) => {
        fastify.log.error(`[WS] Socket error: ${err.message}`);
      });
    }
  );

  // Health: number of active streaming sessions
  fastify.get("/stream/status", async () => ({
    activeSessions: getActiveSessionCount(),
  }));
};