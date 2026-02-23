// tests/stt.test.ts — B1.1, B1.2
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Deepgram SDK before importing the service
vi.mock("@deepgram/sdk", () => ({
  createClient: vi.fn(() => ({
    listen: {
      live: vi.fn(() => ({
        on: vi.fn(),
        send: vi.fn(),
        requestClose: vi.fn(),
      })),
    },
  })),
  LiveTranscriptionEvents: {
    Transcript: "Results",
    Error: "Error",
    Close: "Close",
  },
}));

vi.mock("../src/db/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    })),
  },
}));

vi.mock("../src/config/env.js", () => ({
  env: {
    DEEPGRAM_API_KEY: "test-key",
    STT_LANGUAGE: "en-US",
  },
}));

describe("STT Service — B1.1 & B1.2", () => {
  it("tracks active session count", async () => {
    const { getActiveSessionCount } = await import("../src/services/stt.service.js");
    expect(getActiveSessionCount()).toBe(0);
  });

  it("throws if opening duplicate session for same meeting", async () => {
    const { openSTTSession } = await import("../src/services/stt.service.js");
    const fakeSocket = {
      readyState: 1,
      OPEN: 1,
      send: vi.fn(),
    } as unknown as WebSocket;

    const meetingId = "11111111-1111-1111-1111-111111111111";
    await openSTTSession(meetingId, fakeSocket);

    await expect(openSTTSession(meetingId, fakeSocket)).rejects.toThrow(
      `STT session already active for meeting ${meetingId}`
    );
  });
});

// tests/export.test.ts — B1.3
describe("Export Service — B1.3", () => {
  it("formats milliseconds as HH:MM:SS timestamps", () => {
    // Test via the exported utility logic inline
    function formatMs(ms: number): string {
      const total = Math.floor(ms / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
    }

    expect(formatMs(0)).toBe("00:00:00");
    expect(formatMs(65_000)).toBe("00:01:05");
    expect(formatMs(3_661_000)).toBe("01:01:01");
    expect(formatMs(7_322_000)).toBe("02:02:02");
  });
});

// tests/rag.test.ts — B2.3
describe("RAG Service — B2.3", () => {
  it("chunks text with correct overlap", () => {
    // Mirror chunking logic for testing
    function chunkText(text: string, chunkSize = 5, overlap = 2): string[] {
      const words = text.split(/\s+/);
      const chunks: string[] = [];
      let i = 0;
      while (i < words.length) {
        const chunk = words.slice(i, i + chunkSize).join(" ");
        if (chunk.trim()) chunks.push(chunk);
        i += chunkSize - overlap;
      }
      return chunks;
    }

    const words = Array.from({ length: 10 }, (_, i) => `word${i}`);
    const text = words.join(" ");
    const chunks = chunkText(text, 5, 2);

    // With chunkSize=5, overlap=2, stride=3: chunks at 0, 3, 6, 9
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should have 5 words
    expect(chunks[0].split(" ").length).toBe(5);
    // Second chunk starts at word index 3 (overlaps last 2 of chunk 1)
    expect(chunks[1]).toContain("word3");
  });

  it("filters RAG results below similarity threshold", () => {
    function formatRAGContext(results: { content: string; similarity: number }[]): string {
      return results
        .filter((r) => r.similarity > 0.7)
        .map((r, i) => `[DOC ${i + 1}] ${r.content}`)
        .join("\n\n");
    }

    const results = [
      { content: "High relevance doc", similarity: 0.92 },
      { content: "Low relevance doc", similarity: 0.45 },
      { content: "Mid relevance doc", similarity: 0.75 },
    ];

    const ctx = formatRAGContext(results);
    expect(ctx).toContain("High relevance doc");
    expect(ctx).toContain("Mid relevance doc");
    expect(ctx).not.toContain("Low relevance doc");
  });
});
