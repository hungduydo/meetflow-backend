import type { WebSocket } from "@fastify/websocket";
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
export declare function openSTTSession(meetingId: string, extensionSocket: WebSocket): Promise<void>;
/**
 * B1.1: Pipe an incoming audio chunk into the Deepgram session.
 * If the session isn't ready yet, queue the chunk (FIX 1).
 */
export declare function sendAudioChunk(meetingId: string, chunk: Buffer): void;
/**
 * B1.1: Gracefully close and clean up the STT session.
 */
export declare function closeSTTSession(meetingId: string): Promise<void>;
export declare function getActiveSessionCount(): number;
//# sourceMappingURL=stt.service.d.ts.map