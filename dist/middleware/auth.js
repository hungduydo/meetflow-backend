"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const supabase_js_1 = require("../db/supabase.js");
async function authenticate(req, reply) {
    const authHeader = req.headers.authorization;
    req.log.info({ hasHeader: !!authHeader, authHeader: authHeader ? authHeader.slice(0, 15) + "..." : null }, "Auth request received");
    if (!authHeader?.startsWith("Bearer ")) {
        req.log.warn({ authHeader }, "Missing or invalid Authorization header");
        return reply.status(401).send({ error: "Missing or invalid Authorization header" });
    }
    const token = authHeader.slice(7);
    const { data, error } = await supabase_js_1.supabase.auth.getUser(token);
    if (error) {
        req.log.error({ token: token.slice(0, 10) + "...", error }, "Supabase auth error");
    }
    if (error || !data?.user) {
        req.log.warn({ hasUser: !!data?.user, error: error?.message }, "Authentication failed");
        return reply.status(401).send({ error: "Invalid or expired token" });
    }
    // Ensure user exists in public.users table (B2.5)
    const { data: userData, error: userError } = await supabase_js_1.supabase
        .from("users")
        .select("id")
        .eq("id", data.user.id)
        .single();
    if (userError || !userData) {
        req.log.info({ userId: data.user.id }, "User not found in public.users, creating...");
        const { error: insertError } = await supabase_js_1.supabase.from("users").insert({
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.user_metadata?.full_name ?? null,
            avatar_url: data.user.user_metadata?.avatar_url ?? null,
        });
        if (insertError) {
            req.log.error({ insertError, userId: data.user.id }, "Failed to sync user to public.users");
            return reply.status(500).send({ error: "Failed to sync user data" });
        }
    }
    // Attach user to request for downstream handlers
    req.user = data.user;
}
//# sourceMappingURL=auth.js.map