"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordingsRoute = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const promises_1 = require("node:stream/promises");
const uuid_1 = require("uuid");
const UPLOAD_DIR = (0, node_path_1.join)(process.cwd(), "uploads", "recordings");
if (!(0, node_fs_1.existsSync)(UPLOAD_DIR))
    (0, node_fs_1.mkdirSync)(UPLOAD_DIR, { recursive: true });
const MIME_TO_EXT = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/ogg": "ogg",
    "audio/ogg;codecs=opus": "ogg",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
};
const EXT_TO_MIME = {
    webm: "audio/webm",
    ogg: "audio/ogg",
    wav: "audio/wav",
    mp3: "audio/mpeg",
};
const recordingsRoute = async (fastify) => {
    // POST /api/recordings — receive audio blob, save to disk
    // No auth required: this is a local diagnostic endpoint.
    // The token is sent in the Authorization header but not strictly validated
    // so the feature works even before auth is fully wired.
    fastify.post("/", async (req, reply) => {
        const file = await req.file({
            limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per recording
        });
        if (!file)
            return reply.status(400).send({ error: "No file uploaded" });
        const mimeBase = file.mimetype.split(";")[0].trim();
        const ext = MIME_TO_EXT[mimeBase] ?? MIME_TO_EXT[file.mimetype] ?? "webm";
        const filename = `${(0, uuid_1.v4)()}.${ext}`;
        const filepath = (0, node_path_1.join)(UPLOAD_DIR, filename);
        await (0, promises_1.pipeline)(file.file, (0, node_fs_1.createWriteStream)(filepath));
        fastify.log.info(`[Rec] Saved recording: ${filename}`);
        return { filename, url: `/api/recordings/${filename}` };
    });
    // GET /api/recordings/:filename — serve audio file for playback
    fastify.get("/:filename", async (req, reply) => {
        const { filename } = req.params;
        // Reject path traversal attempts
        if (!/^[\w\-.]+$/.test(filename)) {
            return reply.status(400).send({ error: "Invalid filename" });
        }
        const filepath = (0, node_path_1.join)(UPLOAD_DIR, filename);
        if (!(0, node_fs_1.existsSync)(filepath)) {
            return reply.status(404).send({ error: "Recording not found" });
        }
        const ext = filename.split(".").pop() ?? "webm";
        reply.header("Content-Type", EXT_TO_MIME[ext] ?? "audio/webm");
        reply.header("Accept-Ranges", "bytes");
        reply.header("Cache-Control", "no-cache");
        return reply.send((0, node_fs_1.createReadStream)(filepath));
    });
};
exports.recordingsRoute = recordingsRoute;
//# sourceMappingURL=recordings.route.js.map