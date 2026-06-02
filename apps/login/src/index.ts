import { createAuth } from "./auth";
import { getMigrations } from "better-auth/db/migration";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const auth = createAuth(env);
    const url = new URL(request.url);

    if (url.pathname === "/migrate" && request.method === "POST") {
      if (request.headers.get("x-migrate-secret") !== env.BETTER_AUTH_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
      return Response.json({ message: "Migrations complete" });
    }

    if (url.pathname.startsWith("/api/auth")) {
      return auth.handler(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
