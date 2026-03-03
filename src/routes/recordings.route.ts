// routes/recordings.route.ts
// Record an audio clip from the extension, save to disk, serve back for playback.
// Used to verify the full audio pipeline independently of Deepgram transcription.
import type { FastifyPluginAsync } from "fastify";
import { createWriteStream, createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { v4 as uuid } from "uuid";

const UPLOAD_DIR = join(process.cwd(), "uploads", "recordings");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME_TO_EXT: Record<string, string> = {
  "audio/webm":         "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/ogg":          "ogg",
  "audio/ogg;codecs=opus": "ogg",
  "audio/wav":          "wav",
  "audio/mpeg":         "mp3",
};

const EXT_TO_MIME: Record<string, string> = {
  webm: "audio/webm",
  ogg:  "audio/ogg",
  wav:  "audio/wav",
  mp3:  "audio/mpeg",
};

export const recordingsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /api/recordings — receive audio blob, save to disk
  // No auth required: this is a local diagnostic endpoint.
  // The token is sent in the Authorization header but not strictly validated
  // so the feature works even before auth is fully wired.
  fastify.post("/", async (req, reply) => {
    const file = await req.file({
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per recording
    });
    if (!file) return reply.status(400).send({ error: "No file uploaded" });

    const mimeBase = file.mimetype.split(";")[0].trim();
    const ext = MIME_TO_EXT[mimeBase] ?? MIME_TO_EXT[file.mimetype] ?? "webm";
    const filename = `${uuid()}.${ext}`;
    const filepath = join(UPLOAD_DIR, filename);

    await pipeline(file.file, createWriteStream(filepath));
    fastify.log.info(`[Rec] Saved recording: ${filename}`);

    return { filename, url: `/api/recordings/${filename}` };
  });

  // GET /api/recordings/:filename — serve audio file for playback
  fastify.get<{ Params: { filename: string } }>("/:filename", async (req, reply) => {
    const { filename } = req.params;

    // Reject path traversal attempts
    if (!/^[\w\-.]+$/.test(filename)) {
      return reply.status(400).send({ error: "Invalid filename" });
    }

    const filepath = join(UPLOAD_DIR, filename);
    if (!existsSync(filepath)) {
      return reply.status(404).send({ error: "Recording not found" });
    }

    const ext = filename.split(".").pop() ?? "webm";
    reply.header("Content-Type", EXT_TO_MIME[ext] ?? "audio/webm");
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "no-cache");
    return reply.send(createReadStream(filepath));
  });
};
