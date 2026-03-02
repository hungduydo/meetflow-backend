"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSTTSession = openSTTSession;
exports.sendAudioChunk = sendAudioChunk;
exports.closeSTTSession = closeSTTSession;
exports.getActiveSessionCount = getActiveSessionCount;
// services/stt.service.ts
// B1.1: WebSocket session management
// B1.2: Deepgram real-time STT integration (<2s latency target)
const sdk_1 = require("@deepgram/sdk");
const supabase_js_1 = require("../db/supabase.js");
const env_js_1 = require("../config/env.js");
const uuid_1 = require("uuid");
const deepgram = (0, sdk_1.createClient)(env_js_1.env.DEEPGRAM_API_KEY);
// Active sessions: meetingId → SessionEntry
const sessions = new Map();
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
async function openSTTSession(meetingId, extensionSocket) {
    if (sessions.has(meetingId)) {
        throw new Error(`STT session already active for meeting ${meetingId}`);
    }
    // The extension streams raw linear16 PCM (Int16 LE, mono, 16 kHz) captured
    // via ScriptProcessorNode. This is Deepgram's recommended format for live
    // streaming — no container overhead, no format ambiguity.
    // Previous approaches used MediaRecorder → WebM container, which Deepgram's
    // streaming endpoint cannot parse regardless of the encoding= parameter,
    // causing it to close the connection immediately with no transcript.
    const dgSession = deepgram.listen.live({
        language: env_js_1.env.STT_LANGUAGE,
        model: "nova-2",
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
        smart_format: true,
        diarize: true,
        punctuate: true,
        interim_results: true,
        endpointing: 300,
        utterance_end_ms: 1000,
    });
    const entry = {
        dg: dgSession,
        ready: false,
        queue: [],
        // FIX 2: keepAlive every 8s to prevent Deepgram's 10s idle timeout
        keepAliveTimer: setInterval(() => {
            if (entry.ready)
                dgSession.keepAlive();
        }, 8_000),
    };
    sessions.set(meetingId, entry);
    // FIX 1: Buffer chunks until Deepgram's own WS is confirmed open
    dgSession.on(sdk_1.LiveTranscriptionEvents.Open, () => {
        entry.ready = true;
        console.log(`[STT] Deepgram connection open for meeting ${meetingId}. Flushing ${entry.queue.length} queued chunk(s).`);
        // Flush any chunks that arrived before the connection was ready
        for (const chunk of entry.queue) {
            dgSession.send(chunk);
        }
        entry.queue = [];
    });
    dgSession.on(sdk_1.LiveTranscriptionEvents.Transcript, async (result) => {
        const alt = result.channel?.alternatives?.[0];
        if (!alt?.transcript)
            return;
        console.log(result.channel);
        const segment = {
            id: (0, uuid_1.v4)(),
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
            await supabase_js_1.supabase.from("transcript_segments").insert({
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
    dgSession.on(sdk_1.LiveTranscriptionEvents.Error, (err) => {
        console.error(`[STT] Deepgram error for meeting ${meetingId}:`, err);
        if (extensionSocket.readyState === extensionSocket.OPEN) {
            extensionSocket.send(JSON.stringify({ type: "error", message: "STT engine error" }));
        }
    });
    dgSession.on(sdk_1.LiveTranscriptionEvents.Close, () => {
        clearInterval(entry.keepAliveTimer);
        const wasActive = sessions.has(meetingId);
        sessions.delete(meetingId);
        console.log(`[STT] Deepgram session closed for meeting ${meetingId}`);
        // Notify client if the close was unexpected (i.e. closeSTTSession() was
        // not the caller — in that case the extension WS is already closed).
        if (wasActive && extensionSocket.readyState === extensionSocket.OPEN) {
            console.error(`[STT] Deepgram closed unexpectedly for meeting ${meetingId}`);
            extensionSocket.send(JSON.stringify({ type: "error", message: "Transcription service closed — please stop and restart recording" }));
        }
    });
}
/**
 * B1.1: Pipe an incoming audio chunk into the Deepgram session.
 * If the session isn't ready yet, queue the chunk (FIX 1).
 */
function sendAudioChunk(meetingId, chunk) {
    const entry = sessions.get(meetingId);
    if (!entry)
        throw new Error(`No active STT session for meeting ${meetingId}`);
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
async function closeSTTSession(meetingId) {
    const entry = sessions.get(meetingId);
    if (!entry)
        return;
    clearInterval(entry.keepAliveTimer);
    entry.dg.requestClose();
    sessions.delete(meetingId);
    await supabase_js_1.supabase
        .from("meetings")
        .update({ status: "completed", ended_at: new Date().toISOString() })
        .eq("id", meetingId);
}
function getActiveSessionCount() {
    return sessions.size;
}
//# sourceMappingURL=stt.service.js.map