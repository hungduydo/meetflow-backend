import type { FastifyRequest, FastifyReply } from "fastify";
export declare function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<undefined>;
declare module "fastify" {
    interface FastifyRequest {
        user: {
            id: string;
            email?: string;
        };
    }
}
//# sourceMappingURL=auth.d.ts.map