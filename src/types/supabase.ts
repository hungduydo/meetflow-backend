// types/supabase.ts — B2.5: Database schema types
// Run `npm run db:generate` to regenerate from live Supabase schema

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["users"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
      };
      meetings: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          google_meet_url: string | null;
          started_at: string;
          ended_at: string | null;
          status: "active" | "completed" | "processing";
          raw_transcript: string | null;
          summary: string | null;
          action_items: Json | null;
          decisions: Json | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["meetings"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["meetings"]["Insert"]>;
      };
      transcript_segments: {
        Row: {
          id: string;
          meeting_id: string;
          speaker_id: string | null;
          speaker_label: string | null;
          text: string;
          confidence: number | null;
          start_ms: number;
          end_ms: number;
          is_final: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["transcript_segments"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["transcript_segments"]["Insert"]>;
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          filename: string;
          file_size: number;
          mime_type: string;
          storage_path: string;
          chunk_count: number;
          status: "pending" | "processing" | "ready" | "failed";
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["documents"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["documents"]["Insert"]>;
      };
      document_chunks: {
        Row: {
          id: string;
          document_id: string;
          user_id: string;
          content: string;
          chunk_index: number;
          token_count: number;
          embedding: number[] | null; // pgvector
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["document_chunks"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["document_chunks"]["Insert"]>;
      };
      smart_replies: {
        Row: {
          id: string;
          meeting_id: string;
          trigger_text: string;
          reply_professional: string;
          reply_casual: string;
          reply_concise: string;
          was_used: boolean;
          used_variant: "professional" | "casual" | "concise" | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["smart_replies"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["smart_replies"]["Insert"]>;
      };
    };
    Functions: {
      match_document_chunks: {
        Args: { query_embedding: number[]; match_count: number; user_id_filter: string };
        Returns: { id: string; content: string; similarity: number; document_id: string }[];
      };
      search_transcript_segments: {
        Args: { meeting_id_filter: string; query: string; limit_count: number };
        Returns: { id: string; text: string; speaker_label: string | null; start_ms: number }[];
      };
    };
  };
}
