// services/stt.service.ts
// B1.1: WebSocket session management
// B1.2: Deepgram real-time STT integration (<2s latency target)
import fs from "fs";
import path from "path";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import type { WebSocket } from "@fastify/websocket";
import { supabase } from "../db/supabase.js";
import { env } from "../config/env.js";
import { v4 as uuid } from "uuid";

const deepgram = createClient(env.DEEPGRAM_API_KEY);

const STREAM_URL = 'https://playerservices.streamtheworld.com/api/livestream-redirect/CSPANRADIOAAC.aac';
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

interface STTSessionState {
  client: ReturnType<typeof deepgram.listen.live>;
  chunkBuffer: Buffer[];
  isOpen: boolean;
}

// Active sessions: meetingId → STTSessionState
const sessions = new Map<string, STTSessionState>();

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
  const client = deepgram.listen.live({
    model: "nova-2",
    language: env.STT_LANGUAGE,
    smart_format: true,
    diarize: true,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000,
    encoding: "opus",
    container: "webm",
    channels: 1,
    sample_rate: 16000,
  });

  const sessionState: STTSessionState = {
    client,
    chunkBuffer: [],
    isOpen: false,
  };

  sessions.set(meetingId, sessionState);
  // On session open we livesteam a fake meeting for test
  // client.on(LiveTranscriptionEvents.Open, async () => {
  //   console.log(`Transcribing ${STREAM_URL}...`);

  //   const response = await fetch(STREAM_URL, { redirect: 'follow' });
  //   const reader = response?.body?.getReader();

  //   const pump = async () => {
  //     const { done, value } = await reader!.read();
  //     if (done) return;
  //     client.send(value);
  //     pump();
  //   };
  //   pump();
  // });

  client.on(LiveTranscriptionEvents.Open, () => {
    console.log(`[STT] Deepgram session opened for meeting ${meetingId}`);
    sessionState.isOpen = true;
    while (sessionState.chunkBuffer.length > 0) {
      const b = sessionState.chunkBuffer.shift();
      if (b) client.send(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    }
  });

  client.on(LiveTranscriptionEvents.Metadata, (metadata) => {
    console.log(`[STT] Deepgram metadata for meeting ${meetingId}:`, JSON.stringify(metadata));
  });

  // Forward interim results to extension immediately (< 2s latency)
  client.on(LiveTranscriptionEvents.Transcript, async (result) => {
    console.log(`[STT] Transcript event for meeting ${meetingId}:`, JSON.stringify(result));
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

  client.on(LiveTranscriptionEvents.SpeechStarted, () => {
    console.log(`[STT] Speech started for meeting ${meetingId}`);
  });

  client.on(LiveTranscriptionEvents.UtteranceEnd, () => {
    console.log(`[STT] Utterance end for meeting ${meetingId}`);
  });

  client.on(LiveTranscriptionEvents.Error, (err) => {
    console.error(`[STT] Deepgram error for meeting ${meetingId}:`, err);
    if (extensionSocket.readyState === extensionSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "error", message: "STT engine error" }));
    }
  });

  client.on(LiveTranscriptionEvents.Close, () => {
    console.log(`[STT] Deepgram session closed for meeting ${meetingId}`);
    sessions.delete(meetingId);
  });
}

console.log("[STT-VERSION: 1.0.3] Service initialized");

/**
 * B1.1: Pipe an incoming audio chunk from the extension into the Deepgram session.
 */
export function sendAudioChunk(meetingId: string, chunk: Buffer): void {
  const sessionState = sessions.get(meetingId);
  console.log(`[STT-VERSION: 1.0.3] Chunk: ${chunk.length} bytes, Hex: ${chunk.slice(0, 4).toString("hex")}`);

  // DEBUG: Save incoming audio chunk to file
  const debugFile = path.join(process.cwd(), `logs/debug-${meetingId}.webm`);
  if (!fs.existsSync(path.dirname(debugFile))) {
    fs.mkdirSync(path.dirname(debugFile), { recursive: true });
  }
  fs.appendFileSync(debugFile, chunk);

  if (!sessionState) throw new Error(`No active STT session for meeting ${meetingId}`);

  if (sessionState.isOpen) {
    console.log(`[STT] SENDING direct to Deepgram (${meetingId})`);
    sessionState.client.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
  } else {
    sessionState.chunkBuffer.push(chunk);
    console.log(`[STT] BUFFERED chunk ${sessionState.chunkBuffer.length} for meeting ${meetingId}`);
  }
}

/**
 * B1.1: Gracefully close and clean up the STT session.
 */
export async function closeSTTSession(meetingId: string): Promise<void> {
  const sessionState = sessions.get(meetingId);
  if (!sessionState) return;
  sessionState.client.requestClose();
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
