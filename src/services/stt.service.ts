// services/stt.service.ts
// B1.1: WebSocket session management
// B1.2: Deepgram real-time STT integration (<2s latency target)
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import type { WebSocket } from "@fastify/websocket";
import { supabase } from "../db/supabase.js";
import { env } from "../config/env.js";
import { v4 as uuid } from "uuid";

const deepgram = createClient(env.DEEPGRAM_API_KEY);

export interface TranscriptSegment {
  id: string;
  meetingId: string;
  text: string;
  speakerId: string | null;
  startMs: number;
  endMs: number;
  confidence: number;
  isFinal: boolean;
}

// Active sessions: meetingId → DeepgramLiveClient
const sessions = new Map<string, ReturnType<typeof deepgram.listen.live>>();

/**
 * B1.1: Opens a Deepgram streaming session for a meeting.
 * Forwards final transcripts to the DB and interim ones over the extension WS.
 */
export async function openSTTSession(
  meetingId: string,
  extensionSocket: WebSocket
): Promise<void> {
  if (sessions.has(meetingId)) {
    throw new Error(`STT session already active for meeting ${meetingId}`);
  }

  // B1.2: Deepgram live transcription config
  const dgSession = deepgram.listen.live({
    language: env.STT_LANGUAGE,
    model: "nova-2",           // Best WER for English (target < 8%)
    smart_format: true,
    diarize: true,             // B3.1: Speaker diarization (used in Phase 3)
    punctuate: true,
    interim_results: true,
    endpointing: 300,          // ms silence before utterance end
    utterance_end_ms: 1000,
  });

  sessions.set(meetingId, dgSession);

  // Forward interim results to extension immediately (< 2s latency)
  dgSession.on(LiveTranscriptionEvents.Transcript, async (result) => {
    const alt = result.channel?.alternatives?.[0];
    if (!alt?.transcript) return;

    const segment: TranscriptSegment = {
      id: uuid(),
      meetingId,
      text: alt.transcript,
      speakerId: alt.words?.[0]?.speaker?.toString() ?? null,
      startMs: Math.round((result.start ?? 0) * 1000),
      endMs: Math.round(((result.start ?? 0) + (result.duration ?? 0)) * 1000),
      confidence: alt.confidence ?? 1,
      isFinal: result.is_final ?? false,
    };

    // Push to extension WS immediately (interim + final)
    if (extensionSocket.readyState === extensionSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "transcript", data: segment }));
    }

    // Persist only final segments to Supabase
    if (segment.isFinal && segment.text.trim()) {
      await supabase.from("transcript_segments").insert({
        id: segment.id,
        meeting_id: meetingId,
        speaker_id: segment.speakerId,
        text: segment.text,
        confidence: segment.confidence,
        start_ms: segment.startMs,
        end_ms: segment.endMs,
        is_final: true,
      });
    }
  });

  dgSession.on(LiveTranscriptionEvents.Error, (err) => {
    console.error(`[STT] Deepgram error for meeting ${meetingId}:`, err);
    if (extensionSocket.readyState === extensionSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "error", message: "STT engine error" }));
    }
  });

  dgSession.on(LiveTranscriptionEvents.Close, () => {
    sessions.delete(meetingId);
  });
}

/**
 * B1.1: Pipe an incoming audio chunk from the extension into the Deepgram session.
 */
export function sendAudioChunk(meetingId: string, chunk: Buffer): void {
  const session = sessions.get(meetingId);
  if (!session) throw new Error(`No active STT session for meeting ${meetingId}`);
  session.send(chunk);
}

/**
 * B1.1: Gracefully close and clean up the STT session.
 */
export async function closeSTTSession(meetingId: string): Promise<void> {
  const session = sessions.get(meetingId);
  if (!session) return;
  session.requestClose();
  sessions.delete(meetingId);

  // Mark meeting as completed in DB
  await supabase
    .from("meetings")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", meetingId);
}

export function getActiveSessionCount(): number {
  return sessions.size;
}
