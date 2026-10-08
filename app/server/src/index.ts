/* SmartBuilder standalone server (Bun).
 *
 * Serves the built React client and the action RPC endpoint the client
 * calls (`POST /actions` with `{ action, args }`). All business logic is
 * the original action layer (actions.ts) running against MySQL through
 * the runtime shim (runtime.ts).
 */
import { join, normalize } from "node:path";
import { ZodError } from "zod";
import { Actions } from "./actions";
import type { ActionDefinition } from "./runtime";
import { ctx, pool, waitForDb } from "./db";

const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = process.env.CLIENT_DIST ?? join(import.meta.dir, "../../client/dist");
const MAX_BODY_BYTES = 64 * 1024 * 1024; // task photos / blueprints travel as data URLs in action args

const actionMap = Actions as unknown as Record<string, ActionDefinition>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleActions(req: Request): Promise<Response> {
  let body: { action?: unknown; args?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "Request too large" }, 413);
    body = JSON.parse(text) as { action?: unknown; args?: unknown };
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const name = typeof body.action === "string" ? body.action : "";
  const def = actionMap[name];
  if (!def) return json({ error: `Unknown action: ${name || "(missing)"}` }, 404);

  let args: unknown;
  try {
    args = def.request.parse(body.args ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      return json({ error: `Invalid request for ${name}: ${err.issues[0]?.message ?? "validation failed"}` }, 400);
    }
    throw err;
  }

  try {
    const result = await def.handler(ctx, args as never);
    try {
      return json({ result: def.response.parse(result) });
    } catch {
      // A handler returning more than its declared response schema is the
      // app's own data either way — send it rather than fail the screen.
      return json({ result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error(`[actions] ${name} failed:`, err);
    // Business-rule errors are thrown as Error(message) by the handlers and
    // shown to the user verbatim by the client.
    return json({ error: message }, 400);
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(CLIENT_DIST, rel === "/" || rel === "." ? "index.html" : rel);
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600" },
    });
  }
  // SPA fallback: every client route is the same shell.
  const index = Bun.file(join(CLIENT_DIST, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "cache-control": "no-cache" } });
  }
  return new Response("Client not built yet. Run: bun run build:client", { status: 503 });
}

await waitForDb();
console.log("[smartbuilder] database reachable");

Bun.serve({
  port: PORT,
  maxRequestBodySize: MAX_BODY_BYTES,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      try {
        await pool.query("SELECT 1");
        return json({ ok: true });
      } catch {
        return json({ ok: false }, 503);
      }
    }
    if (url.pathname === "/actions" || url.pathname === "/actions/") {
      if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
      return handleActions(req);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return json({ error: "Method not allowed" }, 405);
    }
    return serveStatic(url.pathname);
  },
});

console.log(`[smartbuilder] listening on http://0.0.0.0:${PORT} (client: ${CLIENT_DIST})`);
