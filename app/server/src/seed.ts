/* Demo tenant seed.
 *
 * Runs the app's own bootstrap action against the MySQL database — the
 * exact same code path that seeds the Muse pilot on first load — so the
 * demo data can never drift from what the app itself creates:
 *
 *   BUILDER001  LOG Construction   (full demo: users, clients, projects,
 *                                   jobs + tasks, timesheets, invoices,
 *                                   starter services, demo fleet, and the
 *                                   demo client-portal login)
 *   BUILDER002  Demo Construction  (empty demo tenant with one admin user)
 *
 * Idempotent: every insert is guarded by the app's own "already seeded"
 * checks, so running this twice changes nothing.
 *
 * Usage:  bun run seed        (or: docker compose exec app bun run seed)
 */
import { Actions } from "./actions";
import type { ActionDefinition } from "./runtime";
import { ctx, pool, waitForDb } from "./db";

async function call(name: string, args: unknown): Promise<never> {
  const def = (Actions as unknown as Record<string, ActionDefinition>)[name];
  if (!def) throw new Error(`Unknown action ${name}`);
  const parsed = def.request.parse(args ?? {});
  return def.handler(ctx, parsed as never) as Promise<never>;
}

await waitForDb();
console.log("[seed] database reachable — running bootstrap…");

const boot = (await call("getBootstrap", {})) as {
  companies: Array<{ id: string; name: string }>;
  users: Array<{ id: number; companyId: string; name: string; role: string }>;
};

// The demo fleet (2 vehicles per tenant) is seeded lazily by listVehicles;
// trigger it once per tenant so the Fleet screen opens populated.
for (const company of boot.companies) {
  const admin = boot.users.find((u) => u.companyId === company.id && u.role === "admin") ??
    boot.users.find((u) => u.companyId === company.id);
  if (!admin) continue;
  await call("listVehicles", { companyId: company.id, actorId: admin.id });
}

for (const company of boot.companies) {
  const users = boot.users.filter((u) => u.companyId === company.id);
  console.log(`[seed] ${company.id} — ${company.name}: ${users.length} user(s)`);
  for (const u of users) console.log(`         · ${u.name} (${u.role})`);
}
console.log("[seed] demo client portal: roberto.client@demo.smartbuilder / client123");
console.log("[seed] done.");

await pool.end();
process.exit(0);
