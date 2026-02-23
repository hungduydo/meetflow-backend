// middleware/auth.ts — JWT verification for all protected routes
import type { FastifyRequest, FastifyReply } from "fastify";
import { supabase } from "../db/supabase.js";

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return reply.status(401).send({ error: "Invalid or expired token" });
  }

  // Attach user to request for downstream handlers
  (req as FastifyRequest & { user: typeof data.user }).user = data.user;
}

// Declare augmented type globally for downstream usage
declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email?: string };
  }
}
