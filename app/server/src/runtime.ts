/* Standalone runtime shim.
 *
 * The SmartBuilder action layer was written against the Muse artifact
 * runtime (`@hatch/space-sdk`). For the self-hosted build, actions.ts
 * imports `defineAction`, `z`, `ActionsModule` and `SpaceDb` from this
 * module instead. Everything else (request/response Zod schemas, handler
 * bodies, tenant checks) is the original application code, unchanged.
 *
 * Differences from the hosted runtime, by design:
 *  - `ctx.db()` returns a Drizzle MySQL database (mysql2 pool) instead of
 *    the artifact's SQLite database. The schema (schema.ts) is the MySQL
 *    port of the same tables/columns.
 *  - `ctx.invalidateQueries()` is a no-op: invalidation hints were only
 *    meaningful inside the Muse shell. The React client already
 *    invalidates its own react-query caches after mutations and refetches
 *    on window focus.
 */
import { z } from "zod";
import type { MySql2Database } from "drizzle-orm/mysql2";

export { z };

/** Drizzle database handle, generic over the app schema (same role the
 *  artifact runtime's SpaceDb played). */
export type SpaceDb<TSchema extends Record<string, unknown>> = MySql2Database<TSchema>;

export interface ActionContext {
  db: <TSchema extends Record<string, unknown>>() => SpaceDb<TSchema>;
  invalidateQueries: (..._keys: unknown[]) => Promise<void>;
}

export interface ActionDefinition {
  request: z.ZodType;
  response: z.ZodType;
  handler: (ctx: ActionContext, args: never) => Promise<unknown>;
}

export type ActionsModule = Record<string, ActionDefinition>;

/** Registers one RPC action. The HTTP dispatcher (index.ts) validates the
 *  request body against `request`, runs `handler`, and returns its result.
 *  Handler args are typed from the request schema (defaults applied),
 *  exactly as in the hosted runtime. */
export function defineAction<Req extends z.ZodType, Res extends z.ZodType>(def: {
  request: Req;
  response: Res;
  handler: (ctx: ActionContext, args: z.output<Req>) => Promise<unknown>;
}): { request: Req; response: Res; handler: (ctx: ActionContext, args: z.output<Req>) => Promise<unknown> } {
  return def;
}

/** Builds the ctx object handed to every action handler. */
export function createActionContext(db: MySql2Database<Record<string, unknown>>): ActionContext {
  return {
    db: <TSchema extends Record<string, unknown>>() => db as unknown as SpaceDb<TSchema>,
    invalidateQueries: async () => {
      /* no-op outside the Muse shell — see header note */
    },
  };
}
