// services/llm.service.ts
// B2.1: Gemini 1.5 Flash integration with rolling 10-20 min context window
import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../config/env.js";
import { supabase } from "../db/supabase.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

function getModel() {
  return genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  });
}

/**
 * B2.1: Fetch the rolling transcript context for a meeting.
 * Maintains the last 10-20 minutes of conversation in the prompt buffer.
 */
export async function getMeetingContext(
  meetingId: string,
  windowMs: number = 20 * 60 * 1000 // 20-minute window
): Promise<string> {
  const cutoffMs = Date.now() - windowMs;

  const { data: segments } = await supabase
    .from("transcript_segments")
    .select("text, speaker_label, start_ms")
    .eq("meeting_id", meetingId)
    .eq("is_final", true)
    .gte("start_ms", cutoffMs)
    .order("start_ms", { ascending: true });

  if (!segments?.length) return "";

  return segments
    .map((s) => `${s.speaker_label ?? "Speaker"}: ${s.text}`)
    .join("\n");
}

// ── B2.2: Smart Reply Generation ──────────────────────────────────────────────
export interface SmartReply {
  professional: string;
  casual: string;
  concise: string;
}

const SMART_REPLY_PROMPT = (context: string, trigger: string) => `
You are an AI meeting assistant for MeetFlow. Based on the meeting transcript below,
generate 3 reply options for the participant who was just addressed.

MEETING CONTEXT (last 20 minutes):
${context}

QUESTION/STATEMENT DIRECTED AT USER:
"${trigger}"

Generate exactly 3 reply variants. Return ONLY valid JSON, no markdown:
{
  "professional": "...",
  "casual": "...",
  "concise": "..."
}

Rules:
- Professional: formal, thorough, uses business language
- Casual: friendly, conversational, natural
- Concise: one sentence max, direct answer
- All replies must be grounded in the meeting context
- Do not invent facts not mentioned in the transcript
`;

export async function generateSmartReplies(
  meetingId: string,
  triggerText: string,
  ragContext?: string
): Promise<SmartReply> {
  const meetingContext = await getMeetingContext(meetingId);
  const fullContext = ragContext
    ? `${meetingContext}\n\n[REFERENCE DOCUMENTS]\n${ragContext}`
    : meetingContext;

  const model = getModel();
  const result = await model.generateContent(SMART_REPLY_PROMPT(fullContext, triggerText));
  const text = result.response.text().trim();

  try {
    return JSON.parse(text) as SmartReply;
  } catch {
    // Fallback: extract JSON from markdown code block if model wraps it
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) return JSON.parse(match[1]) as SmartReply;
    throw new Error("Failed to parse LLM smart reply response");
  }
}

// ── B3.2: Meeting Minutes Generation ─────────────────────────────────────────
export interface MeetingMinutes {
  summary: string;
  actionItems: { task: string; assignee: string | null; dueDate: string | null }[];
  decisions: { decision: string; context: string }[];
  keyTopics: string[];
}

const MINUTES_PROMPT = (transcript: string) => `
You are an expert meeting scribe. Analyze the full meeting transcript below and generate
structured meeting minutes. Return ONLY valid JSON, no markdown.

FULL TRANSCRIPT:
${transcript}

{
  "summary": "2-3 sentence high-level overview of the meeting",
  "actionItems": [
    { "task": "...", "assignee": "name or null", "dueDate": "ISO date string or null" }
  ],
  "decisions": [
    { "decision": "...", "context": "brief context for why this was decided" }
  ],
  "keyTopics": ["topic1", "topic2"]
}
`;

export async function generateMeetingMinutes(meetingId: string): Promise<MeetingMinutes> {
  const { data: segments } = await supabase
    .from("transcript_segments")
    .select("text, speaker_label, start_ms")
    .eq("meeting_id", meetingId)
    .eq("is_final", true)
    .order("start_ms", { ascending: true });

  if (!segments?.length) {
    throw new Error("No transcript segments found for this meeting");
  }

  const fullTranscript = segments
    .map((s) => `${s.speaker_label ?? "Speaker"}: ${s.text}`)
    .join("\n");

  const model = getModel();
  const result = await model.generateContent(MINUTES_PROMPT(fullTranscript));
  const text = result.response.text().trim();

  try {
    return JSON.parse(text) as MeetingMinutes;
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) return JSON.parse(match[1]) as MeetingMinutes;
    throw new Error("Failed to parse LLM meeting minutes response");
  }
}

// ── B2.4: Magic Search — natural language over transcript ─────────────────────
const MAGIC_SEARCH_PROMPT = (context: string, query: string) => `
You are a meeting assistant. The user is searching their live meeting transcript.

TRANSCRIPT CONTEXT:
${context}

USER QUERY: "${query}"

Find the most relevant moments from the transcript that answer this query.
Return ONLY valid JSON:
{
  "answer": "direct answer to the query in 1-2 sentences",
  "relevantQuotes": [
    { "speaker": "...", "text": "...", "relevance": "why this quote is relevant" }
  ]
}
Limit to top 3 quotes. If not found, set answer to "Not mentioned in this meeting."
`;

export async function magicSearch(
  meetingId: string,
  query: string
): Promise<{ answer: string; relevantQuotes: { speaker: string; text: string; relevance: string }[] }> {
  const context = await getMeetingContext(meetingId);
  if (!context) return { answer: "No transcript available yet.", relevantQuotes: [] };

  const model = getModel();
  const result = await model.generateContent(MAGIC_SEARCH_PROMPT(context, query));
  const text = result.response.text().trim();

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) return JSON.parse(match[1]);
    throw new Error("Failed to parse magic search response");
  }
}
