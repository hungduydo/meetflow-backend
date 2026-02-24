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

interface SessionEntry {
  dg: ReturnType<typeof deepgram.listen.live>;
  ready: boolean;              // true once Deepgram Open event fires
  queue: Buffer[];             // chunks buffered before ready
  keepAliveTimer: ReturnType<typeof setInterval>;
}

// Active sessions: meetingId → SessionEntry
const sessions = new Map<string, SessionEntry>();

/**
 * B1.1: Opens a Deepgram streaming session for a meeting.
 *
 * FIX 1 — Wait for Deepgram's Open event before sending audio.
 *   The Deepgram SDK opens its own WebSocket internally. Audio sent before
 *   that socket is OPEN is silently dropped → no transcripts ever arrive.
 *   Solution: queue chunks until the Open event fires, then flush.
 *
 * FIX 2 — Send keepAlive every 8s.
 *   Deepgram closes idle connections after ~10s of no data. When the user
 *   pauses speaking the audio stream carries silence, but MediaRecorder may
 *   produce near-empty chunks that Deepgram's server doesn't count as activity.
 *   Solution: send Deepgram's keepAlive message on an interval.
 *
 * FIX 3 — Correct encoding hint.
 *   The browser sends audio/webm (Opus). We must tell Deepgram the encoding
 *   so it can demux the container correctly. Without this it tries to parse
 *   raw PCM and produces garbage → no transcripts.
 */
export async function openSTTSession(
  meetingId: string,
  extensionSocket: WebSocket
): Promise<void> {
  if (sessions.has(meetingId)) {
    throw new Error(`STT session already active for meeting ${meetingId}`);
  }

  // FIX 3: Declare encoding=opus and the webm container so Deepgram can
  // demux the MediaRecorder output correctly.
  const dgSession = deepgram.listen.live({
    language: env.STT_LANGUAGE,
    model: "nova-2",
    encoding: "opus",           // ← matches MediaRecorder "audio/webm;codecs=opus"
    container: "webm",          // ← tells Deepgram to expect a webm container
    sample_rate: 16000,
    channels: 1,
    smart_format: true,
    diarize: true,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000,
  });

  const entry: SessionEntry = {
    dg: dgSession,
    ready: false,
    queue: [],
    // FIX 2: keepAlive every 8s to prevent Deepgram's 10s idle timeout
    keepAliveTimer: setInterval(() => {
      if (entry.ready) dgSession.keepAlive();
    }, 8_000),
  };
  sessions.set(meetingId, entry);

  // FIX 1: Buffer chunks until Deepgram's own WS is confirmed open
  dgSession.on(LiveTranscriptionEvents.Open, () => {
    entry.ready = true;
    console.log(`[STT] Deepgram connection open for meeting ${meetingId}. Flushing ${entry.queue.length} queued chunk(s).`);
    // Flush any chunks that arrived before the connection was ready
    for (const chunk of entry.queue) {
      dgSession.send(chunk);
    }
    entry.queue = [];
  });

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

    if (extensionSocket.readyState === extensionSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "transcript", data: segment }));
    }

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
    clearInterval(entry.keepAliveTimer);
    sessions.delete(meetingId);
    console.log(`[STT] Deepgram session closed for meeting ${meetingId}`);
  });
}

/**
 * B1.1: Pipe an incoming audio chunk into the Deepgram session.
 * If the session isn't ready yet, queue the chunk (FIX 1).
 */
export function sendAudioChunk(meetingId: string, chunk: Buffer): void {
  const entry = sessions.get(meetingId);
  if (!entry) throw new Error(`No active STT session for meeting ${meetingId}`);

  if (!entry.ready) {
    // FIX 1: Deepgram WS not open yet — buffer the chunk
    entry.queue.push(chunk);
    return;
  }

  entry.dg.send(chunk);
}

/**
 * B1.1: Gracefully close and clean up the STT session.
 */
export async function closeSTTSession(meetingId: string): Promise<void> {
  const entry = sessions.get(meetingId);
  if (!entry) return;

  clearInterval(entry.keepAliveTimer);
  entry.dg.requestClose();
  sessions.delete(meetingId);

  await supabase
    .from("meetings")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("id", meetingId);
}

export function getActiveSessionCount(): number {
  return sessions.size;
}