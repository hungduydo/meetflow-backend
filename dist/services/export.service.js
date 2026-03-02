"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportTranscriptAsTxt = exportTranscriptAsTxt;
// services/export.service.ts
// B1.3: Compile transcript segments into downloadable .txt with timestamps
const supabase_js_1 = require("../db/supabase.js");
function formatMs(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}
async function exportTranscriptAsTxt(meetingId) {
    const { data: meeting } = await supabase_js_1.supabase
        .from("meetings")
        .select("title, started_at")
        .eq("id", meetingId)
        .single();
    const { data: segments } = await supabase_js_1.supabase
        .from("transcript_segments")
        .select("text, speaker_label, start_ms, end_ms")
        .eq("meeting_id", meetingId)
        .eq("is_final", true)
        .order("start_ms", { ascending: true });
    const header = [
        `MeetFlow AI — Meeting Transcript`,
        `Title:    ${meeting?.title ?? "Untitled Meeting"}`,
        `Date:     ${meeting?.started_at ? new Date(meeting.started_at).toLocaleString() : "Unknown"}`,
        `Meeting:  ${meetingId}`,
        `Exported: ${new Date().toLocaleString()}`,
        "─".repeat(60),
        "",
    ].join("\n");
    const body = (segments ?? [])
        .map((s) => {
        const ts = `[${formatMs(s.start_ms)} → ${formatMs(s.end_ms)}]`;
        const speaker = s.speaker_label ?? "Speaker";
        return `${ts} ${speaker}:\n${s.text}\n`;
    })
        .join("\n");
    return Buffer.from(header + body, "utf-8");
}
//# sourceMappingURL=export.service.js.map