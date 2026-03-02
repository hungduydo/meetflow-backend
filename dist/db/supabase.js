"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabaseAnon = exports.supabase = void 0;
exports.createUserClient = createUserClient;
// db/supabase.ts — B2.5: Supabase client (service role for server-side ops)
const supabase_js_1 = require("@supabase/supabase-js");
const env_js_1 = require("../config/env.js");
// Service-role client — full DB access, used only server-side
exports.supabase = (0, supabase_js_1.createClient)(env_js_1.env.SUPABASE_URL, env_js_1.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "public" },
});
// Anon client — for user-scoped operations (respects RLS)
exports.supabaseAnon = (0, supabase_js_1.createClient)(env_js_1.env.SUPABASE_URL, env_js_1.env.SUPABASE_ANON_KEY);
// Helper: create a user-scoped client from a JWT
function createUserClient(accessToken) {
    return (0, supabase_js_1.createClient)(env_js_1.env.SUPABASE_URL, env_js_1.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
}
//# sourceMappingURL=supabase.js.map