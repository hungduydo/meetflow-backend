// db/supabase.ts — B2.5: Supabase client (service role for server-side ops)
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase.js";
import { env } from "../config/env.js";

// Service-role client — full DB access, used only server-side
export const supabase = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
  }
);

// Anon client — for user-scoped operations (respects RLS)
export const supabaseAnon = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY
);

// Helper: create a user-scoped client from a JWT
export function createUserClient(accessToken: string) {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
