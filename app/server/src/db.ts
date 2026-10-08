/* Shared MySQL connection + action context for the standalone server
   (used by index.ts and seed.ts). */
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";
import { createActionContext, type ActionContext } from "./runtime";

export type AppDb = MySql2Database<typeof schema>;

export const DATABASE_URL =
  process.env.DATABASE_URL ?? "mysql://smartbuilder:smartbuilder@127.0.0.1:3306/smartbuilder";

export const pool = mysql.createPool({
  uri: DATABASE_URL,
  connectionLimit: 10,
  // Timestamps live in BIGINT ms-epoch columns; keep them JS numbers.
  supportBigNumbers: true,
  bigNumberStrings: false,
});

export const db: AppDb = drizzle(pool, { schema, mode: "default" });

export const ctx: ActionContext = createActionContext(
  db as unknown as MySql2Database<Record<string, unknown>>,
);

/** MySQL (and its init scripts) may still be coming up when the app
 *  container starts; wait until a trivial query succeeds. */
export async function waitForDb(attempts = 60, delayMs = 2000): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Database not reachable after ${attempts} attempts: ${String(lastErr)}`);
}
