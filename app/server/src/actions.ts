import { defineAction, z, type ActionsModule, type SpaceDb } from "./runtime";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import * as schema from "./schema";

/* Pure-TS SHA-256 (actions cannot import host crypto modules). Used only
   to avoid storing portal passwords in plaintext. */
function sha256Hex(input: string): string {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/* ---------- helpers ---------- */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekBounds(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay(); // 0 Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + diffToMon);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: f(mon), end: f(sun) };
}

const companyId = z.string().min(1);
const money = z.number().int().min(0);

/* ---------- structured US address ---------- */
const addressParts = z.object({
  streetNumber: z.string().default(""),
  streetName: z.string().default(""),
  city: z.string().default(""),
  state: z.string().default(""),
  zip: z.string().default(""),
});
type AddressParts = z.infer<typeof addressParts>;
function formatAddress(a: AddressParts): string {
  const line1 = [a.streetNumber, a.streetName].filter(Boolean).join(" ");
  const line2 = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(", ");
}

/* ---------- geofence / ponto helpers ---------- */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

type ZoneResult = { zone: string; distM: number | null };
function zoneFor(proj: { geoLat: number | null; geoLng: number | null; geoRadius: number } | null | undefined, lat: number | null, lng: number | null): ZoneResult {
  if (lat === null || lng === null) return { zone: "sem_gps", distM: null };
  if (!proj || proj.geoLat === null || proj.geoLng === null) return { zone: "sem_cerca", distM: null };
  const d = haversineM(lat, lng, proj.geoLat, proj.geoLng);
  return { zone: d <= proj.geoRadius ? "dentro" : "fora", distM: d };
}

type CtxDb = SpaceDb<typeof schema>;
async function jobNameMap(db: CtxDb, cid: string): Promise<Map<number, string>> {
  const rows = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, cid));
  return new Map(rows.map((j) => [j.id, j.name]));
}
type CompanySettingsFull = {
  noShowCutoff: string; autoCloseTime: string;
  otEnabled: boolean; otDailyHours: number; otWeeklyHours: number; otMultiplier: number;
};
async function getSettings(db: CtxDb, cid: string): Promise<CompanySettingsFull> {
  const rows = await db.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, cid)).limit(1);
  const r = rows[0];
  return {
    noShowCutoff: r?.noShowCutoff ?? "09:00", autoCloseTime: r?.autoCloseTime ?? "17:00",
    otEnabled: (r?.otEnabled ?? 0) === 1, otDailyHours: r?.otDailyHours ?? 8,
    otWeeklyHours: r?.otWeeklyHours ?? 40, otMultiplier: r?.otMultiplier ?? 1.5,
  };
}

async function requireManager(db: CtxDb, cid: string, actorId: number) {
  const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, cid), eq(schema.employees.id, actorId))).limit(1);
  const a = actor[0];
  if (!a || (a.role !== "admin" && a.role !== "gerente")) {
    throw new Error("Only an admin or manager can edit clients and employees.");
  }
  return a;
}

/* Employee may only touch the vehicle(s) assigned to them (fuel logging).
   Returns the actor row; throws if not assigned to the vehicle. */
async function requireVehicleUser(db: CtxDb, cid: string, actorId: number, vehicleId: number) {
  const actor = await getActor(db, cid, actorId);
  if (!actor) throw new Error("Actor not found.");
  if (actor.role === "admin" || actor.role === "gerente") return actor;
  if (actor.role !== "funcionario") throw new Error("Not allowed.");
  const rows = await db.select().from(schema.vehicleAssignments).where(and(
    eq(schema.vehicleAssignments.companyId, cid),
    eq(schema.vehicleAssignments.vehicleId, vehicleId),
    eq(schema.vehicleAssignments.employeeId, actorId),
  )).limit(1);
  const r = rows[0];
  if (!r || r.unassignedAt !== null) throw new Error("You can only log fuel for the vehicle assigned to you.");
  return actor;
}

/* ---------- 5-level access: client portal (STRICTLY read-only) ---------- */
type EmpRow = typeof schema.employees.$inferSelect;
async function getActor(db: CtxDb, cid: string, actorId: number): Promise<EmpRow | null> {
  const rows = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, cid), eq(schema.employees.id, actorId))).limit(1);
  return rows[0] ?? null;
}
function hashPortalPassword(pw: string): string {
  return sha256Hex(`sb-portal:${pw}`);
}
/* Hard rule: a client-role session can NEVER mutate anything — see
   assertInternalActor, which guards every internal action. Portal reads
   go through the dedicated getClient* actions, never the internal ones. */
async function requireAdmin(db: CtxDb, cid: string, actorId: number): Promise<EmpRow> {
  const a = await getActor(db, cid, actorId);
  if (!a || a.role !== "admin") throw new Error("Only the company owner can do this.");
  return a;
}
/* Internal-action guard: a cliente actor may not use ANY internal action
   (read or write) — the portal has its own dedicated read-only actions.
   Picks whichever actor field the action carries. */
async function assertInternalActor(db: CtxDb, rawArgs: object): Promise<void> {
  const args = rawArgs as { companyId?: string; actorId?: number; employeeId?: number; userId?: number };
  const id = args.actorId ?? args.employeeId ?? args.userId;
  if (id === undefined || !args.companyId) return;
  const a = await getActor(db, args.companyId, id);
  if (a && a.role === "cliente") throw new Error("Not permitted: client portal access is read-only.");
}
/* Validates a client-portal session and returns the linked client row.
   Throws for any non-client, disabled, or unlinked account. */
async function requireClientUser(db: CtxDb, cid: string, userId: number): Promise<{ user: EmpRow; client: typeof schema.clients.$inferSelect }> {
  const u = await getActor(db, cid, userId);
  if (!u || u.role !== "cliente") throw new Error("Client portal access required.");
  if (u.status !== "ativo" || u.portalEnabled !== 1) throw new Error("This client portal access is disabled. Please contact your contractor.");
  if (u.clientId === null) throw new Error("This login is not linked to a client yet. Please contact your contractor.");
  const rows = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, cid), eq(schema.clients.id, u.clientId))).limit(1);
  if (!rows[0]) throw new Error("Linked client not found. Please contact your contractor.");
  return { user: u, client: rows[0] };
}
/* Client-safe project shape: NO budget, NO estimated value beyond what the
   invoice itself shows, NO costs/profit. Progress comes from task counts. */
function clientProjectProgress(tasks: Array<{ status: string }>): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100);
}

/* ---------- platform owner / tenant isolation ---------- */
async function requireOwner(db: CtxDb, email: string) {
  const rows = await db.select().from(schema.platformOwners).where(eq(schema.platformOwners.email, email.trim().toLowerCase())).limit(1);
  if (!rows[0]) throw new Error("Platform owner access required. Sign in with the owner account.");
  return rows[0];
}

/* Suspended tenants keep their data but cannot write; enforced server-side
   on the mutation paths so a stale client session can't keep working. */
async function assertTenantWritable(db: CtxDb, cid: string): Promise<void> {
  const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, cid)).limit(1);
  const c = rows[0];
  if (!c) throw new Error("Company not found");
  if (c.status === "suspended") throw new Error("This company is suspended. Contact SmartBuilder to reactivate it.");
}

type TenantDataset = Record<string, Array<Record<string, unknown>>>;
async function collectTenantData(db: CtxDb, cid: string): Promise<TenantDataset> {
  const companyRows = await db.select().from(schema.companies).where(eq(schema.companies.id, cid));
  const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, cid));
  const invIds = new Set(invs.map((i) => i.id));
  const allItems = await db.select().from(schema.invoiceItems);
  const allPayments = await db.select().from(schema.invoicePayments);
  const strip = (rows: Array<Record<string, unknown>>) => rows.map((r) => {
    const { companyId: _ignored, ...rest } = r;
    return rest;
  });
  const raw = <T extends Record<string, unknown>>(rows: T[]) => rows as Array<Record<string, unknown>>;
  return {
    companies: raw(companyRows),
    clients: strip(raw(await db.select().from(schema.clients).where(eq(schema.clients.companyId, cid)))),
    employees: strip(raw(await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid)))),
    projects: strip(raw(await db.select().from(schema.projects).where(eq(schema.projects.companyId, cid)))),
    jobs: strip(raw(await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, cid)))),
    job_tasks: strip(raw(await db.select().from(schema.jobTasks).where(eq(schema.jobTasks.companyId, cid)))),
    task_assignees: strip(raw(await db.select().from(schema.taskAssignees).where(eq(schema.taskAssignees.companyId, cid)))),
    task_photos: strip(raw(await db.select().from(schema.taskPhotos).where(eq(schema.taskPhotos.companyId, cid)))),
    assignments: strip(raw(await db.select().from(schema.assignments).where(eq(schema.assignments.companyId, cid)))),
    timesheets: strip(raw(await db.select().from(schema.timesheets).where(eq(schema.timesheets.companyId, cid)))),
    location_pings: strip(raw(await db.select().from(schema.locationPings).where(eq(schema.locationPings.companyId, cid)))),
    timesheet_adjustments: strip(raw(await db.select().from(schema.timesheetAdjustments).where(eq(schema.timesheetAdjustments.companyId, cid)))),
    company_settings: strip(raw(await db.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, cid)))),
    progress_updates: strip(raw(await db.select().from(schema.progressUpdates).where(eq(schema.progressUpdates.companyId, cid)))),
    expenses: strip(raw(await db.select().from(schema.expenses).where(eq(schema.expenses.companyId, cid)))),
    invoices: strip(raw(invs)),
    invoice_items: raw(allItems.filter((i) => invIds.has(i.invoiceId))),
    invoice_payments: raw(allPayments.filter((p) => invIds.has(p.invoiceId))),
    notifications: strip(raw(await db.select().from(schema.notifications).where(eq(schema.notifications.companyId, cid)))),
    payroll_payouts: strip(raw(await db.select().from(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, cid)))),
    task_time_logs: strip(raw(await db.select().from(schema.taskTimeLogs).where(eq(schema.taskTimeLogs.companyId, cid)))),
    vehicles: strip(raw(await db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, cid)))),
    vehicle_assignments: strip(raw(await db.select().from(schema.vehicleAssignments).where(eq(schema.vehicleAssignments.companyId, cid)))),
    vehicle_mileage_logs: strip(raw(await db.select().from(schema.vehicleMileageLogs).where(eq(schema.vehicleMileageLogs.companyId, cid)))),
    vehicle_fuel_logs: strip(raw(await db.select().from(schema.vehicleFuelLogs).where(eq(schema.vehicleFuelLogs.companyId, cid)))),
    vehicle_maintenance: strip(raw(await db.select().from(schema.vehicleMaintenance).where(eq(schema.vehicleMaintenance.companyId, cid)))),
    vehicle_tickets: strip(raw(await db.select().from(schema.vehicleTickets).where(eq(schema.vehicleTickets.companyId, cid)))),
    services: strip(raw(await db.select().from(schema.services).where(eq(schema.services.companyId, cid)))),
    project_services: strip(raw(await db.select().from(schema.projectServices).where(eq(schema.projectServices.companyId, cid)))),
    project_plans: strip(raw(await db.select().from(schema.projectPlans).where(eq(schema.projectPlans.companyId, cid)))),
  };
}

const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace("T", " ")}'`;
  return `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
/* MySQL types per exported column (snake_case). The dump is self-contained:
   CREATE TABLE + INSERTs for one tenant, company_id stripped because the
   production layout is one database per tenant. */
const SQL_COL_TYPES: Record<string, string> = {
  id: "INT", company_id: "VARCHAR(32)", client_id: "INT NULL", project_id: "INT", job_id: "INT NULL",
  employee_id: "INT", timesheet_id: "INT NULL", invoice_id: "INT", adjusted_by: "INT",
  name: "VARCHAR(191)", code: "VARCHAR(32)", status: "VARCHAR(24)", plan: "VARCHAR(60)",
  contact_name: "VARCHAR(191)", phone: "VARCHAR(40)", email: "VARCHAR(191)", address: "TEXT",
  street_number: "VARCHAR(24)", street_name: "VARCHAR(191)", city: "VARCHAR(120)", state: "VARCHAR(40)", zip: "VARCHAR(16)",
  role: "VARCHAR(24)", trade: "VARCHAR(120)", pay_type: "VARCHAR(24)", pay_rate: "INT",
  scope: "TEXT", start_date: "VARCHAR(10)", end_date: "VARCHAR(10)", budget: "BIGINT", estimated_value: "BIGINT",
  progress: "INT", geo_lat: "DECIMAL(10,7)", geo_lng: "DECIMAL(10,7)", geo_radius: "INT",
  check_in_at: "DATETIME", check_out_at: "DATETIME NULL", created_at: "DATETIME",
  in_lat: "DECIMAL(10,7)", in_lng: "DECIMAL(10,7)", out_lat: "DECIMAL(10,7)", out_lng: "DECIMAL(10,7)",
  in_zone: "VARCHAR(24)", out_zone: "VARCHAR(24)", in_dist_m: "INT NULL", out_dist_m: "INT NULL",
  auto_closed: "TINYINT", hours_calc: "DECIMAL(8,2)", pay_type_snapshot: "VARCHAR(24)", pay_rate_snapshot: "INT",
  note: "TEXT", work_date: "VARCHAR(10)", lat: "DECIMAL(10,7)", lng: "DECIMAL(10,7)", dist_m: "INT NULL", zone: "VARCHAR(24)",
  adjusted_by_name: "VARCHAR(191)", old_check_in_at: "DATETIME", new_check_in_at: "DATETIME",
  old_check_out_at: "DATETIME NULL", new_check_out_at: "DATETIME NULL", old_hours: "DECIMAL(8,2)", new_hours: "DECIMAL(8,2)", reason: "TEXT",
  no_show_cutoff: "VARCHAR(5)", auto_close_time: "VARCHAR(5)",
  photo_url: "LONGTEXT", item: "VARCHAR(191)", quantity: "DECIMAL(10,2)", unit_cost: "INT", supplier: "VARCHAR(191)",
  expense_date: "VARCHAR(10)", receipt_note: "TEXT", number: "VARCHAR(40)", issue_date: "VARCHAR(10)", due_date: "VARCHAR(10)",
  description: "TEXT", unit_price: "INT", amount: "INT", pay_date: "VARCHAR(10)", method: "VARCHAR(40)",
  title: "VARCHAR(191)", notes: "TEXT", assignee_id: "INT NULL", task_id: "INT", sort_order: "INT",
  started_at: "DATETIME NULL", completed_at: "DATETIME NULL", stage: "VARCHAR(16)",
  ot_enabled: "TINYINT", ot_daily_hours: "DECIMAL(5,2)", ot_weekly_hours: "DECIMAL(6,2)", ot_multiplier: "DECIMAL(4,2)",
  billed_invoice_id: "INT NULL", expense_id: "INT NULL",
  user_id: "INT", type: "VARCHAR(32)", link_view: "VARCHAR(24)", link_id: "INT NULL", read_at: "DATETIME NULL", dedupe_key: "VARCHAR(120)",
  period_start: "VARCHAR(10)", period_end: "VARCHAR(10)", regular_hours: "DECIMAL(8,2)", ot_hours: "DECIMAL(8,2)",
  gross: "BIGINT", paid_date: "VARCHAR(10)", reference: "VARCHAR(120)", created_by: "INT",
  kind: "VARCHAR(16)", minutes: "DECIMAL(10,2)", ended_at: "DATETIME NULL",
  hours: "DECIMAL(8,2)", days: "INT",
  invoice_accent_color: "VARCHAR(7)", logo_url: "LONGTEXT",
  services_seeded: "TINYINT", unit: "VARCHAR(60)", default_rate: "INT", service_id: "INT NULL",
  service_name: "VARCHAR(191)", rate: "INT", mime_type: "VARCHAR(80)", file_data: "LONGTEXT",
  thumbnail_data: "LONGTEXT", file_size: "INT", uploaded_by: "INT",
};
function buildTenantSql(tenantName: string, tenantCode: string, data: TenantDataset): string {
  const lines: string[] = [
    "-- ============================================================",
    `-- SmartBuilder — tenant database export`,
    `-- Tenant: ${tenantName} (${tenantCode})`,
    `-- Generated: ${new Date().toISOString()}`,
    "-- Migration path (database-per-tenant): create one MySQL database",
    "-- for this tenant, run the production schema file, then import this",
    "-- dump. company_id is stripped: inside its own database, every row",
    "-- belongs to this tenant.",
    "-- ============================================================",
    "SET NAMES utf8mb4;",
    "",
  ];
  for (const [table, rows] of Object.entries(data)) {
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]!).map(snake);
    lines.push(`CREATE TABLE IF NOT EXISTS \`${table}\` (`);
    lines.push(cols.map((c) => `  \`${c}\` ${SQL_COL_TYPES[c] ?? "TEXT"}`).join(",\n"));
    lines.push(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;");
    for (const r of rows) {
      const vals = Object.keys(r).map((k) => {
        const v = r[k];
        // companies.created_at is stored as ms epoch; emit a DATETIME literal.
        return sqlValue(k === "createdAt" && typeof v === "number" ? new Date(v) : v);
      });
      lines.push(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${vals.join(", ")});`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function hhmmToDate(workDate: string, hhmm: string): Date {
  const [h = 17, m = 0] = hhmm.split(":").map(Number);
  const d = new Date(`${workDate}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

// Encerra automaticamente registros abertos cujo dia já passou do horário-limite
// (padrão 17:00, horário local da empresa/servidor). Sem horas após o limite.
async function applyAutoClose(db: CtxDb, cid: string): Promise<void> {
  const settings = await getSettings(db, cid);
  const now = new Date();
  const open = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, cid), eq(schema.timesheets.status, "aberto")));
  for (const s of open) {
    const cutoff = hhmmToDate(s.workDate, settings.autoCloseTime);
    if (now < cutoff) continue;
    const end = cutoff.getTime() > s.checkInAt.getTime() ? cutoff : s.checkInAt;
    const hrs = Math.round(((end.getTime() - s.checkInAt.getTime()) / 3600000) * 100) / 100;
    const noteParts = [s.note, `Auto-closed at ${settings.autoCloseTime} (no check-out recorded).`].filter(Boolean);
    await db.update(schema.timesheets).set({
      checkOutAt: end, hoursCalc: Math.max(0, hrs), status: "pendente", autoClosed: 1,
      outZone: s.outZone || "sem_gps", note: noteParts.join(" "),
    }).where(eq(schema.timesheets.id, s.id));
    const empRow = await db.select().from(schema.employees).where(eq(schema.employees.id, s.employeeId)).limit(1);
    await notifyManagers(db, cid, {
      type: "timesheet_pending", title: "🕐 Timesheet pending approval",
      detail: `${empRow[0]?.name ?? "Employee"} • ${s.workDate} • ${Math.max(0, hrs).toFixed(1)}h (auto-closed at ${settings.autoCloseTime}).`,
      payload: { name: empRow[0]?.name ?? "Employee", date: s.workDate, hours: Math.max(0, hrs).toFixed(1), autoAt: settings.autoCloseTime },
      linkView: "entries", linkId: s.id, dedupeKey: `pending:${s.id}`,
    });
  }
}

function toSheetOut(s: typeof schema.timesheets.$inferSelect, projectName: string, employeeName: string, jobName = "") {
  return {
    id: s.id, companyId: s.companyId, projectId: s.projectId, projectName, jobId: s.jobId ?? null, jobName,
    employeeId: s.employeeId, employeeName,
    checkInAt: s.checkInAt.toISOString(), checkOutAt: s.checkOutAt?.toISOString() ?? null,
    inLat: s.inLat, inLng: s.inLng, outLat: s.outLat, outLng: s.outLng,
    inZone: s.inZone, outZone: s.outZone, inDistM: s.inDistM, outDistM: s.outDistM,
    autoClosed: s.autoClosed === 1,
    hoursCalc: s.hoursCalc, status: s.status, note: s.note, workDate: s.workDate,
  };
}

const employeeOut = z.object({
  id: z.number(), companyId: z.string(), name: z.string(), role: z.string(),
  trade: z.string(), phone: z.string(), email: z.string(), payType: z.string(),
  payRate: z.number(), status: z.string(),
  clientId: z.number().nullable(), portalEnabled: z.boolean(), hasPortalPassword: z.boolean(),
});
const jobOut = z.object({
  id: z.number(), companyId: z.string(), projectId: z.number(),
  // Linked catalog service (id + snapshots of its name/unit for display;
  // empty when the job is a custom one-off with no catalog link).
  serviceId: z.number().nullable(), serviceName: z.string(), serviceUnit: z.string(),
  name: z.string(), scope: z.string(),
  status: z.string(), startDate: z.string(), endDate: z.string(),
  estimatedValue: z.number(), // cents, 0 = not set
  laborCost: z.number(), // cents — approved timesheets tagged with this job
  laborHours: z.number(),
  crewIds: z.array(z.number()), // employees assigned to this specific job
});
function toJobOut(
  j: typeof schema.jobs.$inferSelect,
  fin: { laborCost: number; laborHours: number }, crewIds: number[],
  svcById?: Map<number, typeof schema.services.$inferSelect>,
) {
  const svc = j.serviceId != null ? svcById?.get(j.serviceId) : undefined;
  return {
    id: j.id, companyId: j.companyId, projectId: j.projectId,
    serviceId: j.serviceId ?? null,
    serviceName: svc?.name ?? "", serviceUnit: svc?.unit ?? "",
    name: j.name, scope: j.scope, status: j.status, startDate: j.startDate, endDate: j.endDate,
    estimatedValue: j.estimatedValue,
    laborCost: fin.laborCost, laborHours: fin.laborHours,
    crewIds,
  };
}
/* Normalized service-name comparison: trims, lowercases, and collapses
   internal whitespace so "Hardwood  Floor " and "hardwood floor" collide. */
function normalizeServiceName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
const projectOut = z.object({
  id: z.number(), companyId: z.string(), clientId: z.number().nullable(),
  clientName: z.string(), name: z.string(), scope: z.string(), address: z.string(), status: z.string(),
  streetNumber: z.string(), streetName: z.string(), city: z.string(), state: z.string(), zip: z.string(),
  startDate: z.string(), endDate: z.string(), budget: z.number(), estimatedValue: z.number(), progress: z.number(),
  geoLat: z.number().nullable(), geoLng: z.number().nullable(), geoRadius: z.number(),
  // Profitability — computed from approved timesheets + expenses (admin/manager views use these)
  laborCost: z.number(), materialsCost: z.number(), totalCost: z.number(), profit: z.number(), profitMargin: z.number(),
});
const clientOut = z.object({
  id: z.number(), companyId: z.string(), name: z.string(), contactName: z.string(),
  phone: z.string(), email: z.string(), email2: z.string(), address: z.string(),
  streetNumber: z.string(), streetName: z.string(), city: z.string(), state: z.string(), zip: z.string(),
  projectCount: z.number(),
});

/* ---------- services catalog + project measurements + plans ---------- */
const serviceOut = z.object({
  id: z.number(), companyId: z.string(), name: z.string(), unit: z.string(),
  defaultRate: z.number(), // cents per unit, 0 = no default rate
});
function toServiceOut(s: typeof schema.services.$inferSelect) {
  return { id: s.id, companyId: s.companyId, name: s.name, unit: s.unit, defaultRate: s.defaultRate };
}
const serviceTypeOut = z.object({
  id: z.number(), companyId: z.string(), name: z.string(), sortOrder: z.number(),
});
const servicePhaseOut = z.object({
  id: z.number(), typeId: z.number(), phaseNumber: z.number(), name: z.string(), description: z.string().nullable(),
});
function toServiceTypeOut(t: typeof schema.serviceTypes.$inferSelect) {
  return { id: t.id, companyId: t.companyId, name: t.name, sortOrder: t.sortOrder };
}
function toServicePhaseOut(p: typeof schema.servicePhases.$inferSelect) {
  return { id: p.id, typeId: p.typeId, phaseNumber: p.phaseNumber, name: p.name, description: p.description ?? null };
}
// Starter service types with phases (e.g. Hardwood Floors with 8 phases).
const STARTER_SERVICE_TYPES: Array<{ name: string; phases: string[] }> = [
  {
    name: "Hardwood Floors",
    phases: [
      "Initial Inspection & Measurements",
      "Site Preparation & Demolition",
      "Subfloor Preparation",
      "Wood Acclimation",
      "Hardwood Floor Installation",
      "Sanding, Staining & Finishing",
      "Baseboards & Transitions",
      "Final Cleaning & Quality Inspection",
    ],
  },
];
async function ensureStarterServiceTypes(db: CtxDb): Promise<void> {
  try {
    const comps = await db.select().from(schema.companies);
    for (const c of comps) {
      const existing = await db.select().from(schema.serviceTypes).where(eq(schema.serviceTypes.companyId, c.id));
      if (existing.length === 0) {
        for (let ti = 0; ti < STARTER_SERVICE_TYPES.length; ti++) {
          const st = STARTER_SERVICE_TYPES[ti];
          const inserted = await db.insert(schema.serviceTypes).values({
            companyId: c.id, name: st.name, sortOrder: ti + 1, createdAt: new Date(),
          });
          const typeId = Number((inserted as unknown as { insertId: number }).insertId);
          for (let pi = 0; pi < st.phases.length; pi++) {
            await db.insert(schema.servicePhases).values({
              typeId, phaseNumber: pi + 1, name: st.phases[pi], createdAt: new Date(),
            });
          }
        }
      }
    }
  } catch { /* tables may not exist yet before the migration runs */ }
}
const projectServiceOut = z.object({
  id: z.number(), companyId: z.string(), projectId: z.number(),
  serviceId: z.number().nullable(), serviceName: z.string(), unit: z.string(),
  quantity: z.number(), rate: z.number(), // cents per unit snapshot
  lineTotal: z.number(), // cents = quantity × rate
});
function toProjectServiceOut(r: typeof schema.projectServices.$inferSelect) {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId,
    serviceId: r.serviceId ?? null, serviceName: r.serviceName, unit: r.unit,
    quantity: r.quantity, rate: r.rate,
    lineTotal: Math.round(r.quantity * r.rate),
  };
}
const projectPlanOut = z.object({
  id: z.number(), companyId: z.string(), projectId: z.number(),
  name: z.string(), mimeType: z.string(), fileSize: z.number(),
  isImage: z.boolean(), thumbnailData: z.string(),
  uploadedBy: z.number(), uploadedByName: z.string(), createdAt: z.string(),
});
function toProjectPlanOut(r: typeof schema.projectPlans.$inferSelect, uploadedByName = "") {
  return {
    id: r.id, companyId: r.companyId, projectId: r.projectId,
    name: r.name, mimeType: r.mimeType, fileSize: r.fileSize,
    isImage: r.mimeType.startsWith("image/"),
    thumbnailData: r.thumbnailData.startsWith("data:image/") ? r.thumbnailData : "",
    uploadedBy: r.uploadedBy, uploadedByName, createdAt: r.createdAt.toISOString(),
  };
}
/* Starter catalog, seeded once per tenant (companies.servicesSeeded).
   Rates are left at 0 on purpose: these are editable starter names and
   units, not the company's real prices. */
const STARTER_SERVICES: Array<{ name: string; unit: string }> = [
  { name: "Hardwood floor", unit: "sq ft" },
  { name: "Tile", unit: "sq ft" },
  { name: "Painting", unit: "sq ft" },
  { name: "Drywall", unit: "sq ft" },
  { name: "Roofing", unit: "sq" },
];
async function ensureStarterServices(db: CtxDb): Promise<void> {
  try {
    const comps = await db.select().from(schema.companies);
    for (const c of comps) {
      if (c.servicesSeeded === 1) continue;
      const existing = await db.select().from(schema.services).where(eq(schema.services.companyId, c.id));
      if (existing.length === 0) {
        await db.insert(schema.services).values(STARTER_SERVICES.map((s, i) => ({
          companyId: c.id, name: s.name, unit: s.unit, defaultRate: 0, sortOrder: i + 1, createdAt: new Date(),
        })));
      }
      await db.update(schema.companies).set({ servicesSeeded: 1 }).where(eq(schema.companies.id, c.id));
    }
  } catch { /* services table may not exist yet before the migration runs */ }
}
/* Crew read access to a project's services/plans: managers see everything
   in their tenant; an employee must be assigned to the project (any row,
   project-level or via one of its jobs). */
async function assertProjectReadable(db: CtxDb, cid: string, projectId: number, actorId: number): Promise<void> {
  const emp = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, cid), eq(schema.employees.id, actorId))).limit(1);
  const e = emp[0];
  if (!e) throw new Error("Employee not found in this company");
  if (e.role === "admin" || e.role === "gerente") return;
  const rows = await db.select().from(schema.assignments).where(and(eq(schema.assignments.companyId, cid), eq(schema.assignments.projectId, projectId), eq(schema.assignments.employeeId, actorId))).limit(1);
  if (rows.length === 0) throw new Error("You are not assigned to this project.");
}
function toClientOut(c: typeof schema.clients.$inferSelect, projectCount = 0) {
  const parts = { streetNumber: c.streetNumber, streetName: c.streetName, city: c.city, state: c.state, zip: c.zip };
  return { id: c.id, companyId: c.companyId, name: c.name, contactName: c.contactName, phone: c.phone, email: c.email, email2: c.email2 ?? "", address: formatAddress(parts) || c.address, ...parts, projectCount };
}
const DEFAULT_INVOICE_ACCENT = "#F97316";
function normalizeInvoiceAccent(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : DEFAULT_INVOICE_ACCENT;
}
const companyProfileOut = z.object({
  id: z.string(), name: z.string(), phone: z.string(), email: z.string(), address: z.string(),
  streetNumber: z.string(), streetName: z.string(), city: z.string(), state: z.string(), zip: z.string(),
  invoiceAccentColor: z.string(), logoUrl: z.string(),
});
function toCompanyProfile(c: typeof schema.companies.$inferSelect) {
  const parts = { streetNumber: c.streetNumber, streetName: c.streetName, city: c.city, state: c.state, zip: c.zip };
  const logoUrl = (c.logoUrl ?? "").startsWith("data:image/") ? c.logoUrl ?? "" : "";
  return { id: c.id, name: c.name, phone: c.phone ?? "", email: c.email ?? "", address: formatAddress(parts) || c.address || "", ...parts, invoiceAccentColor: normalizeInvoiceAccent(c.invoiceAccentColor), logoUrl };
}
function toProjectOut(p: typeof schema.projects.$inferSelect, clientName: string, fin?: { laborCost: number; materialsCost: number }) {
  const parts = { streetNumber: p.streetNumber, streetName: p.streetName, city: p.city, state: p.state, zip: p.zip };
  const laborCost = fin?.laborCost ?? 0;
  const materialsCost = fin?.materialsCost ?? 0;
  const totalCost = laborCost + materialsCost;
  const profit = p.estimatedValue - totalCost;
  const profitMargin = p.estimatedValue > 0 ? Math.round((profit / p.estimatedValue) * 1000) / 10 : 0;
  return { id: p.id, companyId: p.companyId, clientId: p.clientId, clientName, name: p.name, scope: p.scope, address: formatAddress(parts) || p.address, ...parts, status: p.status, startDate: p.startDate, endDate: p.endDate, budget: p.budget, estimatedValue: p.estimatedValue, progress: p.progress, geoLat: p.geoLat, geoLng: p.geoLng, geoRadius: p.geoRadius, laborCost, materialsCost, totalCost, profit, profitMargin };
}

/* Labor cost from APPROVED timesheets only, using the pay captured on each
   entry (payTypeSnapshot / payRateSnapshot) so later pay edits never rewrite
   history. Hourly = hours × rate. Daily = distinct approved days × daily
   rate. Contract = one fixed amount per employee+rate group that has at
   least one approved entry on the project. */
function calcLaborCost(sheets: Array<{ employeeId: number; payTypeSnapshot: string; payRateSnapshot: number; hoursCalc: number; workDate: string }>): number {
  let total = 0;
  const dailyDays = new Map<string, Set<string>>();
  const contractGroups = new Map<string, number>();
  for (const s of sheets) {
    if (s.payTypeSnapshot === "hora") {
      total += Math.round(s.hoursCalc * s.payRateSnapshot);
    } else if (s.payTypeSnapshot === "diaria") {
      const key = `${s.employeeId}:${s.payRateSnapshot}`;
      let set = dailyDays.get(key);
      if (!set) { set = new Set<string>(); dailyDays.set(key, set); }
      set.add(s.workDate);
    } else if (s.payTypeSnapshot === "contrato") {
      const key = `${s.employeeId}:${s.payRateSnapshot}`;
      if (!contractGroups.has(key)) contractGroups.set(key, s.payRateSnapshot);
    }
  }
  for (const [key, days] of dailyDays) {
    const rate = Number(key.split(":")[1] ?? 0);
    total += days.size * rate;
  }
  for (const amt of contractGroups.values()) total += amt;
  return total;
}
const timesheetOut = z.object({
  id: z.number(), companyId: z.string(), projectId: z.number(), projectName: z.string(),
  jobId: z.number().nullable(), jobName: z.string(),
  employeeId: z.number(), employeeName: z.string(),
  checkInAt: z.string(), checkOutAt: z.string().nullable(),
  inLat: z.number().nullable(), inLng: z.number().nullable(),
  outLat: z.number().nullable(), outLng: z.number().nullable(),
  inZone: z.string(), outZone: z.string(),
  inDistM: z.number().nullable(), outDistM: z.number().nullable(),
  autoClosed: z.boolean(),
  hoursCalc: z.number(), status: z.string(), note: z.string(), workDate: z.string(),
});

/* ---------- job tasks (checklist) + task photos ---------- */
const taskPhotoOut = z.object({
  id: z.number(), taskId: z.number(), photoUrl: z.string(), stage: z.string(),
  employeeId: z.number(), employeeName: z.string(), createdAt: z.string(),
});
const jobTaskOut = z.object({
  id: z.number(), companyId: z.string(), jobId: z.number(), projectId: z.number(),
  jobName: z.string(), projectName: z.string(),
  title: z.string(), notes: z.string(),
  // Multi-assignee: every employee who does this task. Empty = whole crew
  // (or Unassigned when the job has no crew yet).
  assigneeIds: z.array(z.number()), assigneeNames: z.array(z.string()),
  // Legacy single-assignee mirror (first id / joined names) for back-compat.
  assigneeId: z.number().nullable(), assigneeName: z.string(),
  status: z.string(),
  createdAt: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable(),
  sortOrder: z.number(),
  photos: z.array(taskPhotoOut),
  // Logged work time on this task (timer segments + manual logs)
  totalMinutes: z.number(),
  timerRunning: z.boolean(), // a timer is running for the requesting actor
  timerStartedAt: z.string().nullable(), // when the actor's running timer started
});
type JobTaskRow = typeof schema.jobTasks.$inferSelect;
type TaskOut = z.infer<typeof jobTaskOut>;
const dispatchCrewMemberOut = z.object({ id: z.number(), name: z.string(), trade: z.string() });
const dispatchJobOut = z.object({
  jobId: z.number(), jobName: z.string(), serviceName: z.string(), serviceUnit: z.string(),
  jobStatus: z.string(), startDate: z.string(), endDate: z.string(),
  crew: z.array(dispatchCrewMemberOut),
  tasks: z.array(jobTaskOut),
  taskTotal: z.number(), taskDone: z.number(), unassignedCount: z.number(),
});
const dispatchProjectOut = z.object({
  projectId: z.number(), projectName: z.string(), projectStatus: z.string(),
  jobs: z.array(dispatchJobOut),
});

/* Builds API-shaped tasks (with photos + assignee/uploader names) for a set
   of task rows. Job/project names are resolved so the field view can group
   tasks by job without a second round-trip. */
async function tasksToOut(db: CtxDb, cid: string, taskRows: JobTaskRow[], actorId = 0): Promise<TaskOut[]> {
  if (taskRows.length === 0) return [];
  const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, cid));
  const jobById = new Map(allJobs.map((j) => [j.id, j]));
  const allProjects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, cid));
  const projById = new Map(allProjects.map((p) => [p.id, p]));
  const allEmps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
  const empById = new Map(allEmps.map((e) => [e.id, e]));
  const taskIds = new Set(taskRows.map((t) => t.id));
  // Multi-assignees per task (task_assignees). Falls back to the legacy
  // single assignee_id for rows seeded before the join table existed.
  const assigneeRows = (await db.select().from(schema.taskAssignees).where(eq(schema.taskAssignees.companyId, cid)).orderBy(asc(schema.taskAssignees.id)))
    .filter((r) => taskIds.has(r.taskId));
  const assigneesByTask = new Map<number, number[]>();
  for (const r of assigneeRows) {
    const arr = assigneesByTask.get(r.taskId) ?? [];
    if (!arr.includes(r.employeeId)) arr.push(r.employeeId);
    assigneesByTask.set(r.taskId, arr);
  }
  for (const t of taskRows) {
    if ((assigneesByTask.get(t.id) ?? []).length === 0 && t.assigneeId !== null) {
      assigneesByTask.set(t.id, [t.assigneeId]);
    }
  }
  const photoRows = (await db.select().from(schema.taskPhotos).where(eq(schema.taskPhotos.companyId, cid)).orderBy(asc(schema.taskPhotos.id)))
    .filter((ph) => taskIds.has(ph.taskId));
  const photosByTask = new Map<number, typeof photoRows>();
  for (const ph of photoRows) {
    const arr = photosByTask.get(ph.taskId) ?? [];
    arr.push(ph);
    photosByTask.set(ph.taskId, arr);
  }
  // Logged work time per task: closed segments carry minutes; a running
  // timer contributes its elapsed time so the total is always current.
  const timeRows = (await db.select().from(schema.taskTimeLogs).where(eq(schema.taskTimeLogs.companyId, cid)))
    .filter((l) => taskIds.has(l.taskId));
  const minutesByTask = new Map<number, number>();
  const actorRunning = new Map<number, Date>();
  const nowMs = Date.now();
  for (const l of timeRows) {
    let mins = l.minutes;
    if (l.endedAt === null && l.startedAt !== null) {
      mins += Math.max(0, (nowMs - l.startedAt.getTime()) / 60000);
      if (l.employeeId === actorId) actorRunning.set(l.taskId, l.startedAt);
    }
    minutesByTask.set(l.taskId, (minutesByTask.get(l.taskId) ?? 0) + mins);
  }
  return taskRows.map((t) => {
    const job = jobById.get(t.jobId);
    const proj = job ? projById.get(job.projectId) : undefined;
    const aIds = assigneesByTask.get(t.id) ?? [];
    const aNames = aIds.map((id) => empById.get(id)?.name ?? "").filter(Boolean);
    return {
      id: t.id, companyId: t.companyId, jobId: t.jobId, projectId: job?.projectId ?? 0,
      jobName: job?.name ?? "", projectName: proj?.name ?? "",
      title: t.title, notes: t.notes,
      assigneeIds: aIds, assigneeNames: aNames,
      assigneeId: aIds[0] ?? null, assigneeName: aNames.join(", "),
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      sortOrder: t.sortOrder,
      photos: (photosByTask.get(t.id) ?? []).map((ph) => ({
        id: ph.id, taskId: ph.taskId, photoUrl: ph.photoUrl, stage: ph.stage,
        employeeId: ph.employeeId, employeeName: empById.get(ph.employeeId)?.name ?? "",
        createdAt: ph.createdAt.toISOString(),
      })),
      totalMinutes: Math.round((minutesByTask.get(t.id) ?? 0) * 10) / 10,
      timerRunning: actorId > 0 && actorRunning.has(t.id),
      timerStartedAt: actorId > 0 && actorRunning.has(t.id) ? actorRunning.get(t.id)!.toISOString() : null,
    };
  });
}
const taskStatusRank = (s: string) => (s === "in_progress" ? 0 : s === "todo" ? 1 : 2);
const sortTasks = <T extends { status: string; sortOrder: number; id: number }>(rows: T[]) =>
  rows.sort((a, b) => taskStatusRank(a.status) - taskStatusRank(b.status) || a.sortOrder - b.sortOrder || a.id - b.id);

/* Who can see/act on a task: managers always; an employee sees a task when
   it is assigned to them, or when it is unassigned (whole crew) and they are
   on the job's crew. An employee assigned only at project level (a floater
   with no specific job crew on that project) also sees its unassigned
   tasks — but job crews stay separate: having a job crew on a project means
   the project-level row does not leak other jobs' tasks in. */
/* Current assignee ids for a task: join table first, legacy column as
   fallback for pre-migration rows. */
async function taskAssigneeIds(db: CtxDb, cid: string, task: JobTaskRow): Promise<number[]> {
  const rows = await db.select().from(schema.taskAssignees)
    .where(and(eq(schema.taskAssignees.companyId, cid), eq(schema.taskAssignees.taskId, task.id)))
    .orderBy(asc(schema.taskAssignees.id));
  const ids: number[] = [];
  for (const r of rows) if (!ids.includes(r.employeeId)) ids.push(r.employeeId);
  if (ids.length === 0 && task.assigneeId !== null) return [task.assigneeId];
  return ids;
}

/* Replaces a task's assignee set (empty = whole crew) and keeps the legacy
   single-assignee column synced to the first id for export/back-compat. */
async function setTaskAssignees(db: CtxDb, cid: string, taskId: number, rawIds: number[]): Promise<number[]> {
  const ids: number[] = [];
  for (const id of rawIds) if (Number.isFinite(id) && !ids.includes(id)) ids.push(id);
  if (ids.length > 0) {
    const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
    const valid = new Set(emps.map((e) => e.id));
    for (const id of ids) if (!valid.has(id)) throw new Error("Assignee not found in this company");
  }
  await db.delete(schema.taskAssignees).where(and(eq(schema.taskAssignees.companyId, cid), eq(schema.taskAssignees.taskId, taskId)));
  for (const id of ids) {
    await db.insert(schema.taskAssignees).values({ companyId: cid, taskId, employeeId: id });
  }
  await db.update(schema.jobTasks).set({ assigneeId: ids[0] ?? null })
    .where(and(eq(schema.jobTasks.companyId, cid), eq(schema.jobTasks.id, taskId)));
  return ids;
}

/* Normalizes create/update input: the new assigneeIds array wins; the
   legacy single assigneeId is still accepted for older clients. */
function resolveAssigneeIds(args: { assigneeIds?: number[]; assigneeId?: number | null }): number[] | undefined {
  if (args.assigneeIds !== undefined) return [...new Set(args.assigneeIds)];
  if (args.assigneeId !== undefined) return args.assigneeId === null ? [] : [args.assigneeId];
  return undefined;
}

async function taskVisibleTo(db: CtxDb, cid: string, employeeId: number, task: JobTaskRow, knownIds?: number[]): Promise<boolean> {
  const ids = knownIds ?? (await taskAssigneeIds(db, cid, task));
  if (ids.includes(employeeId)) return true;
  if (ids.length > 0) return false;
  const emp = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, cid), eq(schema.employees.id, employeeId))).limit(1);
  if (emp[0] && (emp[0].role === "admin" || emp[0].role === "gerente")) return true;
  const job = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, cid), eq(schema.jobs.id, task.jobId))).limit(1);
  if (!job[0]) return false;
  const assigns = await db.select().from(schema.assignments).where(and(eq(schema.assignments.companyId, cid), eq(schema.assignments.employeeId, employeeId)));
  if (assigns.some((a) => a.jobId === task.jobId)) return true;
  const hasJobCrewOnProject = assigns.some((a) => {
    if (a.jobId === null || a.jobId === undefined) return false;
    return a.projectId === job[0]!.projectId;
  });
  if (hasJobCrewOnProject) return false;
  return assigns.some((a) => a.jobId === null && a.projectId === job[0]!.projectId);
}

async function requireTask(db: CtxDb, cid: string, taskId: number): Promise<JobTaskRow> {
  const rows = await db.select().from(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, cid), eq(schema.jobTasks.id, taskId))).limit(1);
  if (!rows[0]) throw new Error("Task not found");
  return rows[0];
}

/* ---------- notifications (in-app; push comes with the native app) ---------- */
async function managerIds(db: CtxDb, cid: string): Promise<number[]> {
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
  return emps.filter((e) => (e.role === "admin" || e.role === "gerente") && e.status === "ativo").map((e) => e.id);
}

type NotifyInput = { type: string; title: string; detail: string; linkView: string; linkId: number | null; dedupeKey?: string; payload?: Record<string, string | number | boolean | null> };
async function notifyUsers(db: CtxDb, cid: string, userIds: number[], n: NotifyInput): Promise<void> {
  for (const uid of userIds) {
    if (n.dedupeKey) {
      const existing = await db.select().from(schema.notifications)
        .where(and(eq(schema.notifications.companyId, cid), eq(schema.notifications.userId, uid), eq(schema.notifications.dedupeKey, n.dedupeKey))).limit(1);
      if (existing[0]) continue;
    }
    await db.insert(schema.notifications).values({
      companyId: cid, userId: uid, type: n.type, title: n.title, detail: n.detail, payload: n.payload ? JSON.stringify(n.payload) : "",
      linkView: n.linkView, linkId: n.linkId, dedupeKey: n.dedupeKey ?? "", createdAt: new Date(),
    });
  }
}
async function notifyManagers(db: CtxDb, cid: string, n: NotifyInput): Promise<void> {
  await notifyUsers(db, cid, await managerIds(db, cid), n);
}

/* Employees expected on site today who have not checked in by the cutoff.
   Shared by the dashboard alerts and the notification scan so both agree. */
async function computeNoShows(db: CtxDb, cid: string): Promise<{ employeeId: number; employeeName: string; projectName: string }[]> {
  const settings = await getSettings(db, cid);
  const td = todayStr();
  const now = new Date();
  if (now.getTime() < hhmmToDate(td, settings.noShowCutoff).getTime()) return [];
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
  const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, cid));
  const assigns = await db.select().from(schema.assignments).where(eq(schema.assignments.companyId, cid));
  const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, cid));
  const jobMap = new Map(allJobs.map((j) => [j.id, j]));
  const projMap = new Map(projs.map((p) => [p.id, p.name]));
  const projStatus = new Map(projs.map((p) => [p.id, p.status]));
  const todaySheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, cid), eq(schema.timesheets.workDate, td)));
  const checkedIn = new Set(todaySheets.map((s) => s.employeeId));
  const expectedOnProject = new Map<number, number>();
  for (const a of assigns) {
    if (expectedOnProject.has(a.employeeId)) continue;
    if (a.jobId !== null && a.jobId !== undefined) {
      const job = jobMap.get(a.jobId);
      if (!job) continue;
      if (job.status === "done") continue;
      if (job.startDate && job.startDate > td) continue;
      if (job.endDate && job.endDate < td) continue;
    }
    expectedOnProject.set(a.employeeId, a.projectId);
  }
  const seen = new Set<number>();
  const out: { employeeId: number; employeeName: string; projectName: string }[] = [];
  for (const a of assigns) {
    if (projStatus.get(a.projectId) === "concluida") continue;
    if (checkedIn.has(a.employeeId) || seen.has(a.employeeId)) continue;
    if (!expectedOnProject.has(a.employeeId)) continue;
    const emp = emps.find((e) => e.id === a.employeeId);
    if (!emp || emp.status !== "ativo" || emp.role !== "funcionario") continue;
    seen.add(a.employeeId);
    out.push({ employeeId: a.employeeId, employeeName: emp.name, projectName: projMap.get(a.projectId) ?? "" });
  }
  return out;
}


/* ---------- fleet / vehicles ---------- */
const vehicleOut = z.object({
  id: z.number(), companyId: z.string(), name: z.string(), make: z.string(), model: z.string(),
  year: z.number(), plate: z.string(), vin: z.string(), photoUrl: z.string(),
  status: z.string(), mileage: z.number(),
  oilIntervalMiles: z.number(), oilIntervalMonths: z.number(),
  lastOilMileage: z.number().nullable(), lastOilDate: z.string(),
  ezpass: z.number(), tagNumber: z.string(),
  currentUserIds: z.array(z.number()), currentUserNames: z.array(z.string()),
  oilState: z.string(), // ok | due_soon | overdue | unknown
  oilDueMileage: z.number().nullable(), oilDueDate: z.string(),
  openTickets: z.number(),
});
type VehicleRow = typeof schema.vehicles.$inferSelect;

function addMonthsStr(dateStr: string, months: number): string {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetweenStr(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00`).getTime();
  const dbMs = new Date(`${b}T12:00:00`).getTime();
  if (Number.isNaN(da) || Number.isNaN(dbMs)) return 0;
  return Math.round((dbMs - da) / 86400000);
}
/* Oil-change status: due when EITHER the mileage or the date limit hits.
   "due soon" = within 500 miles or 14 days of either limit. */
function oilStatusFor(v: VehicleRow): { state: "ok" | "due_soon" | "overdue" | "unknown"; dueMileage: number | null; dueDate: string } {
  const dueMileage = v.lastOilMileage !== null && v.lastOilMileage !== undefined ? v.lastOilMileage + v.oilIntervalMiles : null;
  const dueDate = v.lastOilDate ? addMonthsStr(v.lastOilDate, v.oilIntervalMonths) : "";
  if (dueMileage === null && !dueDate) return { state: "unknown", dueMileage, dueDate };
  const td = todayStr();
  let overdue = false;
  let dueSoon = false;
  if (dueMileage !== null) {
    if (v.mileage >= dueMileage) overdue = true;
    else if (dueMileage - v.mileage <= 500) dueSoon = true;
  }
  if (dueDate) {
    const days = daysBetweenStr(td, dueDate);
    if (days < 0) overdue = true;
    else if (days <= 14) dueSoon = true;
  }
  return { state: overdue ? "overdue" : dueSoon ? "due_soon" : "ok", dueMileage, dueDate };
}

async function vehicleUsersMap(db: CtxDb, cid: string): Promise<Map<number, { ids: number[]; names: string[] }>> {
  const rows = await db.select().from(schema.vehicleAssignments).where(eq(schema.vehicleAssignments.companyId, cid));
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
  const empById = new Map(emps.map((e) => [e.id, e]));
  const out = new Map<number, { ids: number[]; names: string[] }>();
  for (const r of rows) {
    if (r.unassignedAt !== null) continue;
    const cur = out.get(r.vehicleId) ?? { ids: [], names: [] };
    if (!cur.ids.includes(r.employeeId)) {
      cur.ids.push(r.employeeId);
      cur.names.push(empById.get(r.employeeId)?.name ?? "");
    }
    out.set(r.vehicleId, cur);
  }
  return out;
}
function toVehicleOut(v: VehicleRow, users: { ids: number[]; names: string[] }, openTickets = 0): z.infer<typeof vehicleOut> {
  const oil = oilStatusFor(v);
  return {
    id: v.id, companyId: v.companyId, name: v.name, make: v.make, model: v.model,
    year: v.year, plate: v.plate, vin: v.vin,
    photoUrl: (v.photoUrl ?? "").startsWith("data:image/") ? v.photoUrl : "",
    status: v.status, mileage: v.mileage,
    oilIntervalMiles: v.oilIntervalMiles, oilIntervalMonths: v.oilIntervalMonths,
    lastOilMileage: v.lastOilMileage ?? null, lastOilDate: v.lastOilDate,
    ezpass: v.ezpass ?? 0, tagNumber: v.tagNumber ?? "",
    currentUserIds: users.ids, currentUserNames: users.names,
    oilState: oil.state, oilDueMileage: oil.dueMileage, oilDueDate: oil.dueDate,
    openTickets,
  };
}
async function requireVehicle(db: CtxDb, cid: string, vehicleId: number): Promise<VehicleRow> {
  const rows = await db.select().from(schema.vehicles).where(and(eq(schema.vehicles.companyId, cid), eq(schema.vehicles.id, vehicleId))).limit(1);
  if (!rows[0]) throw new Error("Vehicle not found");
  return rows[0];
}
/* Demo fleet, seeded once per tenant (companies.fleetSeeded). Picks the
   first two active field employees as the current users so the demo is
   alive immediately; harmless when the roster is still empty. */
async function ensureFleetSeed(db: CtxDb): Promise<void> {
  try {
    const comps = await db.select().from(schema.companies);
    for (const c of comps) {
      if (c.fleetSeeded === 1) continue;
      const existing = await db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, c.id));
      if (existing.length === 0) {
        const roleRank = (r: string) => (r === "funcionario" ? 0 : r === "gerente" ? 1 : 2);
        const emps = (await db.select().from(schema.employees).where(eq(schema.employees.companyId, c.id)))
          .filter((e) => e.status === "ativo" && e.role !== "cliente")
          .sort((a, b) => roleRank(a.role) - roleRank(b.role));
        const td = todayStr();
        const v1 = await db.insert(schema.vehicles).values({
          companyId: c.id, name: "Truck 1", make: "Ford", model: "F-150", year: 2021, plate: "", vin: "",
          photoUrl: "", status: "active", mileage: 48250, oilIntervalMiles: 5000, oilIntervalMonths: 6,
          lastOilMileage: 45000, lastOilDate: td, createdAt: new Date(),
        }).$returningId();
        const v2 = await db.insert(schema.vehicles).values({
          companyId: c.id, name: "Van 2", make: "Ford", model: "Transit", year: 2020, plate: "", vin: "",
          photoUrl: "", status: "active", mileage: 61900, oilIntervalMiles: 5000, oilIntervalMonths: 6,
          lastOilMileage: 58000, lastOilDate: td, createdAt: new Date(),
        }).$returningId();
        const id1 = v1[0]!.id;
        const id2 = v2[0]!.id;
        if (emps[0]) await db.insert(schema.vehicleAssignments).values({ companyId: c.id, vehicleId: id1, employeeId: emps[0].id, assignedAt: new Date(), unassignedAt: null });
        if (emps[1]) await db.insert(schema.vehicleAssignments).values({ companyId: c.id, vehicleId: id1, employeeId: emps[1].id, assignedAt: new Date(), unassignedAt: null });
        if (emps[0]) await db.insert(schema.vehicleAssignments).values({ companyId: c.id, vehicleId: id2, employeeId: emps[0].id, assignedAt: new Date(), unassignedAt: null });
        await db.insert(schema.vehicleMileageLogs).values({ companyId: c.id, vehicleId: id1, logDate: td, odometer: 48250, notes: "Demo seed — current odometer.", createdAt: new Date() });
        await db.insert(schema.vehicleFuelLogs).values({ companyId: c.id, vehicleId: id1, logDate: td, gallons: 18.5, amount: 6850, odometer: 48250, projectId: null, notes: "Demo fill-up.", createdAt: new Date() });
        await db.insert(schema.vehicleMaintenance).values({ companyId: c.id, vehicleId: id1, maintDate: td, type: "oil_change", cost: 8999, vendor: "Demo Auto Service", odometer: 45000, notes: "Demo oil change (sets the last-oil-change baseline).", receiptNote: "", projectId: null, createdAt: new Date() });
      }
      await db.update(schema.companies).set({ fleetSeeded: 1 }).where(eq(schema.companies.id, c.id));
    }
  } catch { /* fleet tables may not exist yet before the migration runs */ }
}

/* Lazy notification scan: no-shows (today, past cutoff) and overdue invoices.
   Deduped, so calling it on every notification fetch is safe. */
async function scanNotifications(db: CtxDb, cid: string): Promise<void> {
  const td = todayStr();
  const settings = await getSettings(db, cid);
  for (const n of await computeNoShows(db, cid)) {
    await notifyManagers(db, cid, {
      type: "no_show", title: `⏰ No check-in — ${n.employeeName}`,
      detail: `${n.employeeName} was assigned today (${n.projectName}) and has not checked in by ${settings.noShowCutoff}.`,
      payload: { name: n.employeeName, project: n.projectName, cutoff: settings.noShowCutoff },
      linkView: "entries", linkId: null, dedupeKey: `noshow:${n.employeeId}:${td}`,
    });
  }
  const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, cid));
  const cls = await db.select().from(schema.clients).where(eq(schema.clients.companyId, cid));
  const cm = new Map(cls.map((c) => [c.id, c.name]));
  for (const inv of invs) {
    if (inv.dueDate >= td) continue;
    const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
    const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
    const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
    const paid = pays.reduce((s, p) => s + p.amount, 0);
    const balance = total - paid;
    if (balance <= 0) continue;
    await notifyManagers(db, cid, {
      type: "invoice_overdue", title: `🧾 Invoice #${inv.number} is overdue`,
      detail: `${inv.clientId ? (cm.get(inv.clientId) ?? "Client") : "Client"} • Balance due $${(balance / 100).toFixed(2)} • was due ${inv.dueDate}.`,
      payload: { number: inv.number, client: inv.clientId ? (cm.get(inv.clientId) ?? "Client") : "Client", balance: (balance / 100).toFixed(2), dueDate: inv.dueDate },
      linkView: "invoices", linkId: inv.id, dedupeKey: `overdue:${inv.id}`,
    });
  }
  // Fleet: oil-change due / overdue alerts for managers. Deduped per
  // vehicle + oil baseline, so a new oil change re-arms the alert.
  try {
    const vehs = await db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, cid));
    for (const v of vehs) {
      if (v.status === "inactive") continue;
      const oil = oilStatusFor(v);
      if (oil.state !== "due_soon" && oil.state !== "overdue") continue;
      const overdue = oil.state === "overdue";
      await notifyManagers(db, cid, {
        type: "vehicle_oil",
        title: overdue ? `🛢️ Oil change OVERDUE — ${v.name}` : `🛢️ Oil change due soon — ${v.name}`,
        detail: `${v.name} (${[v.year || "", v.make, v.model].filter(Boolean).join(" ")}) • Odometer ${v.mileage.toLocaleString("en-US")} mi${oil.dueMileage !== null ? ` • due at ${oil.dueMileage.toLocaleString("en-US")} mi` : ""}${oil.dueDate ? ` • due ${oil.dueDate}` : ""}.`,
        payload: { vehicle: v.name, state: oil.state, mileage: v.mileage, dueMileage: oil.dueMileage ?? 0, dueDate: oil.dueDate },
        linkView: "fleet", linkId: v.id,
        dedupeKey: `oil:${v.id}:${v.lastOilMileage ?? 0}:${v.lastOilDate}:${oil.state}`,
      });
    }
  } catch { /* fleet tables may not exist yet */ }
}

/* ---------- overtime + payroll computation ---------- */
const round2 = (n: number) => Math.round(n * 100) / 100;
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/* Splits one employee's daily hours into regular vs OT. Daily OT comes off
   first; weekly OT is then taken from the remaining regular hours, per
   Mon–Sun week, so an hour is never counted as OT twice. */
function splitOtHours(dayHours: Map<string, number>, ot: { enabled: boolean; daily: number; weekly: number }): { regular: number; ot: number } {
  const byWeek = new Map<string, Map<string, number>>();
  for (const [date, h] of dayHours) {
    const wk = mondayOf(date);
    const m = byWeek.get(wk) ?? new Map<string, number>();
    m.set(date, h);
    byWeek.set(wk, m);
  }
  let regular = 0; let otHours = 0;
  for (const weekDays of byWeek.values()) {
    let weekRegular = 0; let weekOt = 0;
    for (const h of weekDays.values()) {
      if (ot.enabled && h > ot.daily) { weekOt += h - ot.daily; weekRegular += ot.daily; }
      else weekRegular += h;
    }
    if (ot.enabled && weekRegular > ot.weekly) { weekOt += weekRegular - ot.weekly; weekRegular = ot.weekly; }
    regular += weekRegular; otHours += weekOt;
  }
  return { regular: round2(regular), ot: round2(otHours) };
}

type PayrollRowCalc = {
  employeeId: number; employeeName: string; trade: string; payType: string; payRate: number;
  hours: number; regularHours: number; otHours: number; days: number; amount: number;
};
/* Payroll rows from APPROVED timesheets, grouped per employee + captured
   pay (type, rate) so a mid-period rate change never rewrites history. */
async function computePayrollRows(db: CtxDb, cid: string, from: string | null, to: string | null): Promise<PayrollRowCalc[]> {
  const settings = await getSettings(db, cid);
  const ot = { enabled: settings.otEnabled, daily: settings.otDailyHours, weekly: settings.otWeeklyHours, multiplier: settings.otMultiplier };
  const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, cid));
  let sheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, cid), eq(schema.timesheets.status, "aprovado")));
  if (from !== null && to !== null) sheets = sheets.filter((s) => s.workDate >= from && s.workDate <= to);
  type G = { employeeId: number; payType: string; payRate: number; dayHours: Map<string, number>; entries: number };
  const rows: PayrollRowCalc[] = [];
  for (const emp of emps) {
    const mine = sheets.filter((s) => s.employeeId === emp.id);
    const groups = new Map<string, G>();
    for (const s of mine) {
      const key = `${s.payTypeSnapshot}:${s.payRateSnapshot}`;
      const g = groups.get(key) ?? { employeeId: emp.id, payType: s.payTypeSnapshot, payRate: s.payRateSnapshot, dayHours: new Map<string, number>(), entries: 0 };
      g.dayHours.set(s.workDate, (g.dayHours.get(s.workDate) ?? 0) + s.hoursCalc);
      g.entries += 1;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const hours = round2([...g.dayHours.values()].reduce((a, b) => a + b, 0));
      const days = g.dayHours.size;
      let regularHours = hours; let otHours = 0; let amount = 0;
      if (g.payType === "hora") {
        const split = splitOtHours(g.dayHours, ot);
        regularHours = split.regular; otHours = split.ot;
        amount = Math.round(regularHours * g.payRate + otHours * g.payRate * ot.multiplier);
      } else if (g.payType === "diaria") {
        amount = days * g.payRate;
      } else {
        amount = g.entries > 0 ? g.payRate : 0;
      }
      rows.push({ employeeId: emp.id, employeeName: emp.name, trade: emp.trade, payType: g.payType, payRate: g.payRate, hours, regularHours, otHours, days, amount });
    }
  }
  return rows.filter((r) => r.hours > 0 || r.amount > 0);
}

/* A paid payroll period locks the employee's entries inside it. */
async function paidLockFor(db: CtxDb, cid: string, employeeId: number, workDate: string) {
  const rows = await db.select().from(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, cid));
  return rows.find((p) => p.employeeId === employeeId && p.periodStart <= workDate && workDate <= p.periodEnd) ?? null;
}

export const Actions = {
  /* ================= BOOTSTRAP / SEED ================= */
  getBootstrap: defineAction({
    request: z.object({}),
    response: z.object({
      companies: z.array(z.object({ id: z.string(), name: z.string(), code: z.string(), status: z.string(), plan: z.string() })),
      users: z.array(z.object({ id: z.number(), companyId: z.string(), name: z.string(), role: z.string(), trade: z.string() })),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      // Seed on first load. Guard against concurrent first-load race:
      // only proceed to full seed if employees are still empty after
      // the companies insert settles.
      const companiesNow = await db.select().from(schema.companies);
      let lostSeedRace = false;
      if (companiesNow.length === 0) {
        try {
          await db.insert(schema.companies).values([
            { id: "BUILDER001", name: "LOG Construction", code: "BUILDER001" },
            { id: "BUILDER002", name: "Demo Construction", code: "BUILDER002" },
          ]);
        } catch (e) {
          // Fail LOUD: a silent catch here once left production with an
          // empty database (NOT NULL TEXT columns without DB defaults made
          // the insert throw, and every later call skipped seeding).
          // Only a genuine duplicate-key race is tolerated.
          const msg = e instanceof Error ? e.message : String(e);
          if (/duplicate|ER_DUP_ENTRY|1062/i.test(msg)) {
            lostSeedRace = true;
          } else {
            console.error("[bootstrap] FATAL: demo seed insert failed:", msg);
            throw e;
          }
        }
      }
      if (lostSeedRace) {
        // Another concurrent request is seeding right now; wait briefly
        // for it to finish, then just read the seeded data.
        for (let i = 0; i < 20; i++) {
          const n = (await db.select().from(schema.employees)).length;
          if (n > 0) break;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      const alreadySeeded = (await db.select().from(schema.employees)).length > 0;
      if (!alreadySeeded && !lostSeedRace) {
        // Seed LOG employees
        const LOG = "BUILDER001";
        const emps = await db.insert(schema.employees).values([
          { companyId: LOG, name: "Carlos Eduardo Lima", role: "admin", trade: "Engineer / Admin", phone: "(732) 555-0111", email: "carlos@logconstruction.com", payType: "contrato", payRate: 850000, status: "ativo" },
          { companyId: LOG, name: "Fernanda Oliveira", role: "gerente", trade: "Project Manager", phone: "(732) 555-0112", email: "fernanda@logconstruction.com", payType: "diaria", payRate: 35000, status: "ativo" },
          { companyId: LOG, name: "José Santos Silva", role: "funcionario", trade: "Mason", phone: "(732) 555-0113", email: "jose@logconstruction.com", payType: "hora", payRate: 1850, status: "ativo" },
          { companyId: LOG, name: "Marcos Pereira", role: "funcionario", trade: "Electrician", phone: "(732) 555-0114", email: "marcos@logconstruction.com", payType: "diaria", payRate: 22000, status: "ativo" },
          { companyId: LOG, name: "André Costa", role: "funcionario", trade: "Plumber", phone: "(732) 555-0115", email: "andre@logconstruction.com", payType: "hora", payRate: 2100, status: "ativo" },
        ]).$returningId();
        // Demo company user
        await db.insert(schema.employees).values([
          { companyId: "BUILDER002", name: "Demo User", role: "admin", trade: "Admin", phone: "", email: "demo@demo.com", payType: "contrato", payRate: 0, status: "ativo" },
        ]);
        // Clients for LOG (structured billing addresses — NJ)
        const clients = await db.insert(schema.clients).values([
          { companyId: LOG, name: "Roberto Almeida", contactName: "Roberto Almeida", phone: "(732) 555-0101", email: "roberto@email.com", address: "2401 Hooper Ave, Toms River, NJ 08753", streetNumber: "2401", streetName: "Hooper Ave", city: "Toms River", state: "NJ", zip: "08753" },
          { companyId: LOG, name: "Vila Verde Condominiums", contactName: "HOA Office", phone: "(732) 555-0102", email: "manager@vilaverde.com", address: "875 Herbertsville Rd, Brick Township, NJ 08724", streetNumber: "875", streetName: "Herbertsville Rd", city: "Brick Township", state: "NJ", zip: "08724" },
        ]).$returningId();
        const c1 = clients[0]?.id ?? 1;
        const c2 = clients[1]?.id ?? 2;
        // Demo projects with a geofence in New Jersey (structured addresses).
        // estimatedValue = contract/quoted price the client pays; budget = internal cost budget.
        // Values are set so the profitability panel shows realistic margins against seeded labor+materials.
        const projs = await db.insert(schema.projects).values([
          { companyId: LOG, clientId: c1, name: "Almeida Residence — Full Remodel", scope: "Kitchen remodel: remove the existing cabinets, countertops, sink, and flooring. Install new cabinets, quartz countertops, sink and faucet, tile backsplash, LVP flooring, recessed lighting, and appliances. Protect the hallway floors, keep dust contained, and remove job-site debris at the end of each day.", address: "1420 Hooper Ave, Toms River, NJ 08753", streetNumber: "1420", streetName: "Hooper Ave", city: "Toms River", state: "NJ", zip: "08753", status: "andamento", startDate: "2026-09-15", endDate: "2026-12-20", budget: 18500000, estimatedValue: 780000, progress: 45, geoLat: 39.9756, geoLng: -74.1584, geoRadius: 200 },
          { companyId: LOG, clientId: c2, name: "Vila Verde — Facade Retrofit", scope: "Facade retrofit: inspect and repair damaged stucco, replace failed caulking, wash and prime the exterior, repaint the facade in the approved color, and replace damaged trim boards. Keep walkways open and use the lift only inside the marked work zone.", address: "990 Brick Blvd, Brick Township, NJ 08724", streetNumber: "990", streetName: "Brick Blvd", city: "Brick Township", state: "NJ", zip: "08724", status: "andamento", startDate: "2026-09-28", endDate: "2026-11-30", budget: 9600000, estimatedValue: 540000, progress: 20, geoLat: 40.0389, geoLng: -74.1403, geoRadius: 250 },
          { companyId: LOG, clientId: c1, name: "Almeida Residence — Gourmet Area", scope: "Gourmet area: build the outdoor kitchen base, install stone veneer and granite countertop, complete the sink rough-in and grill connection, and add weatherproof outlets. Confirm every utility shutoff with the manager before starting work.", address: "1420 Hooper Ave, Toms River, NJ 08753", streetNumber: "1420", streetName: "Hooper Ave", city: "Toms River", state: "NJ", zip: "08753", status: "concluida", startDate: "2026-06-01", endDate: "2026-08-30", budget: 5400000, estimatedValue: 485000, progress: 100, geoLat: 39.9756, geoLng: -74.1584, geoRadius: 200 },
        ]).$returningId();
        const p1 = projs[0]?.id ?? 1;
        const p2 = projs[1]?.id ?? 2;
        const e = emps.map((x) => x.id);
        // assignments
        if (e.length >= 5) {
          await db.insert(schema.assignments).values([
            { companyId: LOG, projectId: p1, employeeId: e[2]! },
            { companyId: LOG, projectId: p1, employeeId: e[3]! },
            { companyId: LOG, projectId: p1, employeeId: e[4]! },
            { companyId: LOG, projectId: p2, employeeId: e[2]! },
            { companyId: LOG, projectId: p2, employeeId: e[4]! },
          ]);
        }
        // timesheets this week
        const wb = weekBounds();
        const mon = new Date(`${wb.start}T00:00:00`);
        const mk = (daysAgo: number, hIn: number, hOut: number, empIdx: number, proj: number, status: string) => {
          const d = new Date(mon); d.setDate(mon.getDate() + daysAgo);
          const ci = new Date(d); ci.setHours(hIn, 0, 0, 0);
          const co = new Date(d); co.setHours(hOut, 0, 0, 0);
          const hrs = (co.getTime() - ci.getTime()) / 3600000;
          // GPS dentro da cerca da obra (p1: Toms River / p2: Brick Township)
          const near = proj === p1 ? { lat: 39.9756, lng: -74.1584 } : { lat: 40.0389, lng: -74.1403 };
          const seedPay = [
            { payTypeSnapshot: "contrato" as const, payRateSnapshot: 850000 },
            { payTypeSnapshot: "diaria" as const, payRateSnapshot: 35000 },
            { payTypeSnapshot: "hora" as const, payRateSnapshot: 1850 },
            { payTypeSnapshot: "diaria" as const, payRateSnapshot: 22000 },
            { payTypeSnapshot: "hora" as const, payRateSnapshot: 2100 },
          ][empIdx] ?? { payTypeSnapshot: "hora" as const, payRateSnapshot: 0 };
          return {
            companyId: LOG, projectId: proj, employeeId: e[empIdx]!,
            checkInAt: ci, checkOutAt: co, inLat: near.lat, inLng: near.lng, outLat: near.lat, outLng: near.lng,
            inZone: "dentro", outZone: "dentro", inDistM: 12, outDistM: 15, autoClosed: 0,
            hoursCalc: Math.round(hrs * 100) / 100, ...seedPay, status: status as "aprovado" | "pendente",
            note: "", workDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          };
        };
        if (e.length >= 5) {
          const seededSheets = await db.insert(schema.timesheets).values([
            mk(0, 7, 16, 2, p1, "aprovado"),
            mk(0, 7, 17, 3, p1, "aprovado"),
            mk(0, 8, 16, 4, p2, "pendente"),
            mk(1, 7, 16, 2, p1, "aprovado"),
            mk(1, 7, 15, 4, p1, "pendente"),
            mk(2, 7, 16, 3, p2, "aprovado"),
          ]).$returningId();
          // Trilha de GPS de demonstração (posições a cada 30 min com o app aberto)
          const s0 = seededSheets[0]?.id;
          if (s0 !== undefined) {
            const base = new Date(mon); base.setHours(7, 0, 0, 0);
            await db.insert(schema.locationPings).values([
              { companyId: LOG, timesheetId: s0, employeeId: e[2]!, lat: 39.9756, lng: -74.1584, distM: 12, zone: "dentro", createdAt: new Date(base) },
              { companyId: LOG, timesheetId: s0, employeeId: e[2]!, lat: 39.9757, lng: -74.1582, distM: 18, zone: "dentro", createdAt: new Date(base.getTime() + 30 * 60000) },
              { companyId: LOG, timesheetId: s0, employeeId: e[2]!, lat: 39.9755, lng: -74.1585, distM: 9, zone: "dentro", createdAt: new Date(base.getTime() + 60 * 60000) },
            ]);
          }
        }
        // expenses
        await db.insert(schema.expenses).values([
          { companyId: LOG, projectId: p1, item: "CP-II cement 50kg bag", quantity: 40, unitCost: 3890, supplier: "Home Depot", expenseDate: wb.start, receiptNote: "Receipt 001234" },
          { companyId: LOG, projectId: p1, item: "Clay bricks (per 1,000)", quantity: 3, unitCost: 89000, supplier: "Sao Jorge Supply", expenseDate: wb.start, receiptNote: "Receipt 005678" },
          { companyId: LOG, projectId: p2, item: "Acrylic paint 18L", quantity: 12, unitCost: 28900, supplier: "Sherwin-Williams", expenseDate: wb.start, receiptNote: "" },
          { companyId: LOG, projectId: p1, item: "Electrical wire 2.5mm (roll)", quantity: 5, unitCost: 14500, supplier: "South Electric Supply", expenseDate: wb.end, receiptNote: "" },
        ]);
        // invoices
        const invs = await db.insert(schema.invoices).values([
          { companyId: LOG, clientId: c1, projectId: p1, number: "INV-2026-001", issueDate: "2026-09-20", dueDate: "2026-10-20", status: "paga" },
          { companyId: LOG, clientId: c2, projectId: p2, number: "INV-2026-002", issueDate: "2026-09-28", dueDate: "2026-10-28", status: "parcial" },
          { companyId: LOG, clientId: c1, projectId: p1, number: "INV-2026-003", issueDate: "2026-10-01", dueDate: "2026-10-31", status: "aberta" },
        ]).$returningId();
        if (invs.length >= 3) {
          await db.insert(schema.invoiceItems).values([
            { invoiceId: invs[0]!.id, description: "Phase 1 — Foundations and structure", quantity: 1, unitPrice: 4500000 },
            { invoiceId: invs[1]!.id, description: "Facade retrofit — phase 1", quantity: 1, unitPrice: 3800000 },
            { invoiceId: invs[1]!.id, description: "Scaffolding and protection (monthly)", quantity: 2, unitPrice: 450000 },
            { invoiceId: invs[2]!.id, description: "Phase 2 — Masonry and rough-ins", quantity: 1, unitPrice: 6200000 },
          ]);
          await db.insert(schema.invoicePayments).values([
            { invoiceId: invs[0]!.id, amount: 4500000, payDate: "2026-10-02", method: "Check" },
            { invoiceId: invs[1]!.id, amount: 2000000, payDate: "2026-10-01", method: "ACH transfer" },
          ]);
        }
      }
      // Backfill estimated values for demo projects created before the
      // estimated_value column existed, so the profitability panel shows
      // meaningful numbers on existing databases too. Only fills zeros.
      try {
        const demoEst: Record<string, number> = {
          "Almeida Residence — Full Remodel": 780000,
          "Vila Verde — Facade Retrofit": 540000,
          "Almeida Residence — Gourmet Area": 485000,
        };
        const existing = await db.select().from(schema.projects).where(eq(schema.projects.companyId, "BUILDER001"));
        for (const p of existing) {
          const v = demoEst[p.name];
          if (v !== undefined && p.estimatedValue === 0) {
            await db.update(schema.projects).set({ estimatedValue: v }).where(eq(schema.projects.id, p.id));
          }
        }
      } catch { /* column may not exist yet on very first boot before migration; seed above already covers fresh DBs */ }
      // English-only demo labels: rename any leftover Portuguese demo user or
      // company name from early pilot data (proper names stay untouched).
      try {
        await db.update(schema.employees).set({ name: "Demo User" }).where(eq(schema.employees.name, "Usuário Demo"));
        await db.update(schema.companies).set({ name: "Demo Construction" }).where(eq(schema.companies.name, "Demo Construtora"));
      } catch { /* rename is best-effort */ }
      // Seed demo: split the first demo project into two Jobs (trades) with
      // different crews, so the Jobs feature is visible immediately. Fully
      // idempotent and race-safe: jobs are inserted with a NOT EXISTS guard
      // (concurrent getBootstrap calls can't duplicate them), any duplicate
      // demo jobs left by an early race are merged back into one per name,
      // crew rows are only added when missing, and seeded timesheets are
      // retagged per crew member.
      try {
        const LOGC = "BUILDER001";
        const demoProj = (await db.select().from(schema.projects).where(eq(schema.projects.companyId, LOGC)))
          .find((p) => p.name === "Almeida Residence — Full Remodel");
        if (demoProj) {
          const jobDefs = [
            { name: "Roof replacement", scope: "Roof replacement: strip the old shingles down to the deck, inspect and replace any damaged decking, install synthetic underlayment and architectural shingles, new ridge vent, and flashing at every penetration. Keep the yard clear of nails — magnetic sweep at the end of each day.", status: "in_progress", startDate: "2026-10-01", endDate: "2026-10-23", estimatedValue: 260000, crew: ["José Santos Silva", "André Costa"] },
            { name: "Siding installation", scope: "Siding installation: remove the damaged siding, install house wrap and flashing tape, hang the fiber-cement siding level, and caulk every joint. Match the existing profile and keep transitions clean at windows and corners.", status: "scheduled", startDate: "2026-09-28", endDate: "2026-10-30", estimatedValue: 210000, crew: ["Marcos Pereira"] },
          ];
          for (const def of jobDefs) {
            await db.execute(sql`INSERT INTO jobs (company_id, project_id, name, scope, status, start_date, end_date, estimated_value)
              SELECT ${LOGC}, ${demoProj.id}, ${def.name}, ${def.scope}, ${def.status}, ${def.startDate}, ${def.endDate}, ${def.estimatedValue}
              WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE project_id = ${demoProj.id} AND name = ${def.name})`);
          }
          let demoJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.projectId, demoProj.id));
          // Merge duplicate-name jobs (possible from a concurrent first boot):
          // keep the one holding tagged timesheets (else the lowest id),
          // re-point timesheets/crew of the duplicates, then delete them.
          for (const def of jobDefs) {
            const group = demoJobs.filter((j) => j.name === def.name).sort((a, b) => a.id - b.id);
            if (group.length <= 1) continue;
            const tagged = await db.select({ jobId: schema.timesheets.jobId }).from(schema.timesheets).where(eq(schema.timesheets.projectId, demoProj.id));
            const counts = new Map<number, number>();
            for (const t of tagged) if (t.jobId !== null) counts.set(t.jobId, (counts.get(t.jobId) ?? 0) + 1);
            const keeper = group.reduce((best, j) => ((counts.get(j.id) ?? 0) > (counts.get(best.id) ?? 0) ? j : best), group[0]!);
            const dupeIds = group.filter((j) => j.id !== keeper.id).map((j) => j.id);
            for (const dupId of dupeIds) {
              await db.update(schema.timesheets).set({ jobId: keeper.id }).where(eq(schema.timesheets.jobId, dupId));
              await db.update(schema.assignments).set({ jobId: keeper.id }).where(eq(schema.assignments.jobId, dupId));
              await db.delete(schema.jobs).where(eq(schema.jobs.id, dupId));
            }
          }
          demoJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.projectId, demoProj.id));
          // De-duplicate crew rows inside this project (same employee+job twice).
          await db.execute(sql`DELETE FROM assignments WHERE project_id = ${demoProj.id} AND id NOT IN (
            SELECT MIN(id) FROM assignments WHERE project_id = ${demoProj.id} GROUP BY project_id, IFNULL(job_id, -1), employee_id
          )`);
          const demEmps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, LOGC));
          const byName = new Map(demEmps.map((e) => [e.name, e.id]));
          const existingAssigns = await db.select().from(schema.assignments).where(eq(schema.assignments.projectId, demoProj.id));
          const hasCrew = (jobId: number, empId: number) => existingAssigns.some((a) => a.jobId === jobId && a.employeeId === empId);
          const jobForEmp = new Map<number, number>();
          for (const def of jobDefs) {
            const job = demoJobs.find((j) => j.name === def.name);
            if (!job) continue;
            for (const name of def.crew) {
              const empId = byName.get(name);
              if (empId === undefined) continue;
              jobForEmp.set(empId, job.id);
              if (!hasCrew(job.id, empId)) {
                await db.insert(schema.assignments).values({ companyId: LOGC, projectId: demoProj.id, jobId: job.id, employeeId: empId });
              }
            }
          }
          const demoSheets = await db.select().from(schema.timesheets).where(eq(schema.timesheets.projectId, demoProj.id));
          for (const s of demoSheets) {
            const jid = jobForEmp.get(s.employeeId);
            if (jid !== undefined && s.jobId === null) {
              await db.update(schema.timesheets).set({ jobId: jid }).where(eq(schema.timesheets.id, s.id));
            }
          }
          // Seed demo: task checklists inside the two demo jobs, so the
          // crew-driven flow is visible immediately. Same idempotence
          // contract as the jobs above: NOT EXISTS on (job_id, title),
          // dates relative to the first seed so the In Progress task shows
          // as multi-day work ("In progress • 3 days").
          const DAY = 86400000;
          const nowMs = Date.now();
          const taskDefs: Array<{ job: string; title: string; notes: string; assignee: string | null; status: string; createdAgo: number; startedAgo: number | null; completedAgo: number | null }> = [
            { job: "Roof replacement", title: "Strip old shingles and haul off debris", notes: "Dumpster is on site. Keep nails out of the yard — magnetic sweep at the end of the day.", assignee: "José Santos Silva", status: "done", createdAgo: 5, startedAgo: 5, completedAgo: 4 },
            { job: "Roof replacement", title: "Inspect decking and replace damaged boards", notes: "Check around the chimney and both valleys first.", assignee: "André Costa", status: "in_progress", createdAgo: 4, startedAgo: 3, completedAgo: null },
            { job: "Roof replacement", title: "Install synthetic underlayment and ice-and-water shield", notes: "", assignee: null, status: "todo", createdAgo: 4, startedAgo: null, completedAgo: null },
            { job: "Roof replacement", title: "Install architectural shingles and ridge vent", notes: "", assignee: "José Santos Silva", status: "todo", createdAgo: 4, startedAgo: null, completedAgo: null },
            { job: "Roof replacement", title: "Flash chimneys and vents, final magnetic nail sweep", notes: "", assignee: null, status: "todo", createdAgo: 4, startedAgo: null, completedAgo: null },
            { job: "Siding installation", title: "Remove damaged siding on the south wall", notes: "", assignee: "Marcos Pereira", status: "in_progress", createdAgo: 2, startedAgo: 1, completedAgo: null },
            { job: "Siding installation", title: "Install house wrap and flashing tape", notes: "", assignee: null, status: "todo", createdAgo: 2, startedAgo: null, completedAgo: null },
            { job: "Siding installation", title: "Hang fiber-cement siding and caulk joints", notes: "Match the existing profile; keep window transitions clean.", assignee: "Marcos Pereira", status: "todo", createdAgo: 2, startedAgo: null, completedAgo: null },
          ];
          let sortCursor = 0;
          for (const td of taskDefs) {
            const job = demoJobs.find((j) => j.name === td.job);
            if (!job) continue;
            sortCursor += 1;
            const assigneeId = td.assignee !== null ? (byName.get(td.assignee) ?? null) : null;
            const createdMs = nowMs - td.createdAgo * DAY;
            const startedMs = td.startedAgo !== null ? nowMs - td.startedAgo * DAY : null;
            const completedMs = td.completedAgo !== null ? nowMs - td.completedAgo * DAY : null;
            await db.execute(sql`INSERT INTO job_tasks (company_id, job_id, title, notes, assignee_id, status, sort_order, created_at, started_at, completed_at)
              SELECT ${LOGC}, ${job.id}, ${td.title}, ${td.notes}, ${assigneeId}, ${td.status}, ${sortCursor}, ${createdMs}, ${startedMs}, ${completedMs}
              WHERE NOT EXISTS (SELECT 1 FROM job_tasks WHERE job_id = ${job.id} AND title = ${td.title})`);
          }
          // A third demo job with NO crew yet, so the Dispatch screen shows
          // a realistic mix: some tasks assigned to people, some covered by
          // the whole crew, and these ones truly Unassigned until a manager
          // puts a crew on the job.
          await db.execute(sql`INSERT INTO jobs (company_id, project_id, name, scope, status, start_date, end_date, estimated_value)
            SELECT ${LOGC}, ${demoProj.id}, ${"Final cleanup and walkthrough"}, ${"Final cleanup and walkthrough: remove all debris, sweep and wipe down floors, haul leftover material, and do the final walkthrough with the manager before handover."}, ${"scheduled"}, ${"2026-10-01"}, ${"2026-12-20"}, ${90000}
            WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE project_id = ${demoProj.id} AND name = ${"Final cleanup and walkthrough"})`);
          // Backfill for databases seeded with the later start date, so the
          // job (and its Unassigned tasks) is visible on the Dispatch
          // screen from the first week.
          await db.execute(sql`UPDATE jobs SET start_date = ${"2026-10-01"} WHERE project_id = ${demoProj.id} AND name = ${"Final cleanup and walkthrough"} AND start_date > ${"2026-10-01"}`);
          const freshJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.projectId, demoProj.id));
          const cleanupJob = freshJobs.find((j) => j.name === "Final cleanup and walkthrough");
          if (cleanupJob) {
            const cleanupTasks = [
              { title: "Remove all debris and haul leftover material", notes: "Dumpster pickup is already scheduled — have everything by the curb." },
              { title: "Deep clean floors and wipe down surfaces", notes: "" },
              { title: "Final walkthrough with the manager", notes: "Bring the punch list and mark anything left." },
            ];
            let cSort = 20;
            for (const ct of cleanupTasks) {
              cSort += 1;
              await db.execute(sql`INSERT INTO job_tasks (company_id, job_id, title, notes, assignee_id, status, sort_order, created_at, started_at, completed_at)
                SELECT ${LOGC}, ${cleanupJob.id}, ${ct.title}, ${ct.notes}, ${null}, ${"todo"}, ${cSort}, ${nowMs - DAY}, ${null}, ${null}
                WHERE NOT EXISTS (SELECT 1 FROM job_tasks WHERE job_id = ${cleanupJob.id} AND title = ${ct.title})`);
            }
          }
        }
      } catch { /* jobs table may not exist yet on very first boot before migration */ }
      // Platform owner seed + tenant lifecycle defaults (one-time backfill).
      try {
        const owners = await db.select().from(schema.platformOwners);
        if (owners.length === 0) {
          await db.insert(schema.platformOwners).values({ email: "owner@smartbuilder.app", name: "Platform Owner" });
        }
        const nowMs = Date.now();
        const compsAll = await db.select().from(schema.companies);
        for (const c of compsAll) {
          if (c.createdAt === 0) {
            const patch: Record<string, unknown> = { createdAt: nowMs };
            if (c.id === "BUILDER001") { patch.status = "active"; patch.plan = "Pro"; }
            if (c.id === "BUILDER002") { patch.plan = "Trial"; }
            await db.update(schema.companies).set(patch).where(eq(schema.companies.id, c.id));
          }
        }
      } catch { /* platform_owners table may not exist before migration */ }
      // Demo client portal login (idempotent): Roberto Almeida owns demo
      // projects + invoices at LOG, so the portal opens with real content.
      // Demo credentials (also shown on the login screen):
      // roberto.client@demo.smartbuilder / client123
      try {
        const demoClient = (await db.select().from(schema.clients).where(eq(schema.clients.companyId, "BUILDER001"))).find((c) => c.name === "Roberto Almeida");
        if (demoClient) {
          const existingPortal = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, "BUILDER001"), eq(schema.employees.role, "cliente"), eq(schema.employees.email, "roberto.client@demo.smartbuilder")));
          if (existingPortal.length === 0) {
            await db.insert(schema.employees).values({ companyId: "BUILDER001", name: "Roberto Almeida", role: "cliente", trade: "Client portal", phone: demoClient.phone, email: "roberto.client@demo.smartbuilder", payType: "hora", payRate: 0, status: "ativo", clientId: demoClient.id, portalPassword: hashPortalPassword("client123"), portalEnabled: 1 });
          }
        }
      } catch { /* employees.client_id may not exist before migration */ }
      await ensureStarterServices(db);
      const comps = await db.select().from(schema.companies).orderBy(asc(schema.companies.id));
      const allUsers = await db.select().from(schema.employees).orderBy(asc(schema.employees.name));
      // Suspended tenants cannot log in: their users are not offered at all.
      const suspendedIds = new Set(comps.filter((c) => c.status === "suspended").map((c) => c.id));
      const users = allUsers.filter((u) => !suspendedIds.has(u.companyId));
      return {
        companies: comps.map((c) => ({ id: c.id, name: c.name, code: c.code, status: c.status, plan: c.plan })),
        users: users.map((u) => ({ id: u.id, companyId: u.companyId, name: u.name, role: u.role, trade: u.trade })),
      };
    },
  }),

  /* ================= PROJECTS ================= */
  listProjects: defineAction({
    request: z.object({ companyId }),
    response: z.object({ projects: z.array(projectOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId)).orderBy(desc(schema.projects.id));
      const clientRows = await db.select().from(schema.clients).where(eq(schema.clients.companyId, args.companyId));
      const cm = new Map(clientRows.map((c) => [c.id, c.name]));
      // Profitability per project: approved labor (auto from timesheets) + materials/expenses
      const allSheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.status, "aprovado")));
      const allExps = await db.select().from(schema.expenses).where(eq(schema.expenses.companyId, args.companyId));
      const sheetsByProject = new Map<number, typeof allSheets>();
      for (const s of allSheets) {
        const arr = sheetsByProject.get(s.projectId) ?? [];
        arr.push(s);
        sheetsByProject.set(s.projectId, arr);
      }
      const matsByProject = new Map<number, number>();
      for (const e of allExps) matsByProject.set(e.projectId, (matsByProject.get(e.projectId) ?? 0) + Math.round(e.quantity * e.unitCost));
      return {
        projects: rows.map((p) => toProjectOut(p, p.clientId ? (cm.get(p.clientId) ?? "") : "", {
          laborCost: calcLaborCost(sheetsByProject.get(p.id) ?? []),
          materialsCost: matsByProject.get(p.id) ?? 0,
        })),
      };
    },
  }),

  getProjectDetail: defineAction({
    request: z.object({ companyId, projectId: z.number() }),
    response: z.object({
      project: projectOut.nullable(),
      team: z.array(employeeOut),
      expensesTotal: z.number(),
      laborCost: z.number(),
      totalCost: z.number(),
      profit: z.number(),
      profitMargin: z.number(),
      progressFeed: z.array(z.object({ id: z.number(), note: z.string(), photoUrl: z.string(), employeeName: z.string(), createdAt: z.string() })),
      jobs: z.array(jobOut),
      jobsLabor: z.array(z.object({ jobId: z.number().nullable(), jobName: z.string(), hours: z.number(), laborCost: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const projs = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      const proj = projs[0];
      if (!proj) return { project: null, team: [], expensesTotal: 0, laborCost: 0, totalCost: 0, profit: 0, profitMargin: 0, progressFeed: [], jobs: [], jobsLabor: [] };
      const cl = proj.clientId ? await db.select().from(schema.clients).where(eq(schema.clients.id, proj.clientId)).limit(1) : [];
      const assigns = await db.select().from(schema.assignments).where(eq(schema.assignments.projectId, args.projectId));
      const empIds = assigns.map((a) => a.employeeId);
      const allEmps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const team = allEmps.filter((e) => empIds.includes(e.id)).map((e) => ({ id: e.id, companyId: e.companyId, name: e.name, role: e.role, trade: e.trade, phone: e.phone, email: e.email, payType: e.payType, payRate: e.payRate, status: e.status, clientId: e.clientId ?? null, portalEnabled: e.portalEnabled === 1, hasPortalPassword: (e.portalPassword ?? "") !== "" }));
      const exps = await db.select().from(schema.expenses).where(eq(schema.expenses.projectId, args.projectId));
      const expensesTotal = exps.reduce((s, e) => s + Math.round(e.quantity * e.unitCost), 0);
      const sheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.projectId, args.projectId), eq(schema.timesheets.status, "aprovado")));
      // --- Jobs of this project + labor roll-up per job ---
      const svcRows = await db.select().from(schema.services).where(eq(schema.services.companyId, args.companyId));
      const svcById = new Map(svcRows.map((s) => [s.id, s]));
      const jobRows = await db.select().from(schema.jobs).where(eq(schema.jobs.projectId, args.projectId)).orderBy(asc(schema.jobs.id));
      const jobById = new Map(jobRows.map((j) => [j.id, j]));
      const sheetsByJob = new Map<number, typeof sheets>();
      const unassignedSheets: typeof sheets = [];
      for (const s of sheets) {
        if (s.jobId !== null && jobById.has(s.jobId)) {
          const arr = sheetsByJob.get(s.jobId) ?? [];
          arr.push(s);
          sheetsByJob.set(s.jobId, arr);
        } else {
          unassignedSheets.push(s);
        }
      }
      const crewByJob = new Map<number, number[]>();
      for (const a of assigns) {
        if (a.jobId !== null && a.jobId !== undefined) {
          const arr = crewByJob.get(a.jobId) ?? [];
          if (!arr.includes(a.employeeId)) arr.push(a.employeeId);
          crewByJob.set(a.jobId, arr);
        }
      }
      const jobsOut = jobRows.map((j) => {
        const js = sheetsByJob.get(j.id) ?? [];
        return toJobOut(j, {
          laborCost: calcLaborCost(js),
          laborHours: Math.round(js.reduce((a, s) => a + s.hoursCalc, 0) * 100) / 100,
        }, crewByJob.get(j.id) ?? [], svcById);
      });
      const jobsLabor = [
        ...jobRows.map((j) => {
          const js = sheetsByJob.get(j.id) ?? [];
          return { jobId: j.id as number | null, jobName: j.name, hours: Math.round(js.reduce((a, s) => a + s.hoursCalc, 0) * 100) / 100, laborCost: calcLaborCost(js) };
        }),
        ...(unassignedSheets.length > 0 ? [{ jobId: null as number | null, jobName: "No specific job", hours: Math.round(unassignedSheets.reduce((a, s) => a + s.hoursCalc, 0) * 100) / 100, laborCost: calcLaborCost(unassignedSheets) }] : []),
      ];
      const empMap = new Map(allEmps.map((e) => [e.id, e]));
      const laborCost = calcLaborCost(sheets);
      const totalCost = laborCost + expensesTotal;
      const profit = proj.estimatedValue - totalCost;
      const profitMargin = proj.estimatedValue > 0 ? Math.round((profit / proj.estimatedValue) * 1000) / 10 : 0;
      const feed = await db.select().from(schema.progressUpdates).where(eq(schema.progressUpdates.projectId, args.projectId)).orderBy(desc(schema.progressUpdates.id)).limit(20);
      return {
        project: toProjectOut(proj, cl[0]?.name ?? "", { laborCost, materialsCost: expensesTotal }),
        team, expensesTotal, laborCost, totalCost, profit, profitMargin,
        progressFeed: feed.map((f) => ({ id: f.id, note: f.note, photoUrl: f.photoUrl, employeeName: empMap.get(f.employeeId)?.name ?? "", createdAt: f.createdAt.toISOString() })),
        jobs: jobsOut,
        jobsLabor,
      };
    },
  }),

  /* Dispatch hub: one grouped read for the manager's work-distribution
     screen. Projects -> jobs -> tasks, with crew and who-does-what in a
     single response so the screen is glanceable without N+1 queries.
     A task counts as Unassigned when it has no specific assignee AND its
     job has no crew yet — once a crew exists, a null assignee means the
     whole crew covers it (see Dispatch UI). */
  getDispatch: defineAction({
    request: z.object({ companyId, actorId: z.number(), date: z.string().optional() }),
    response: z.object({ projects: z.array(dispatchProjectOut), unassignedCount: z.number(), totalTasks: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireManager(db, args.companyId, args.actorId);
      const date = args.date ?? "";
      const projRows = (await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId)).orderBy(desc(schema.projects.id)))
        .filter((p) => p.status !== "concluida");
      const jobRowsAll = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, args.companyId)).orderBy(asc(schema.jobs.id));
      const jobRows = jobRowsAll.filter((j) => {
        if (!date) return true;
        if (j.startDate && j.startDate > date) return false;
        if (j.endDate && j.endDate < date) return false;
        return true;
      });
      const jobIds = new Set(jobRows.map((j) => j.id));
      const assignRows = await db.select().from(schema.assignments).where(eq(schema.assignments.companyId, args.companyId));
      const empRows = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const empById = new Map(empRows.map((e) => [e.id, e]));
      const svcRows = await db.select().from(schema.services).where(eq(schema.services.companyId, args.companyId));
      const svcById = new Map(svcRows.map((s) => [s.id, s]));
      const crewByJob = new Map<number, Array<{ id: number; name: string; trade: string }>>();
      for (const a of assignRows) {
        if (a.jobId === null || a.jobId === undefined || !jobIds.has(a.jobId)) continue;
        const emp = empById.get(a.employeeId);
        if (!emp) continue;
        const arr = crewByJob.get(a.jobId) ?? [];
        if (!arr.some((c) => c.id === emp.id)) arr.push({ id: emp.id, name: emp.name, trade: emp.trade });
        crewByJob.set(a.jobId, arr);
      }
      const taskRows = (await db.select().from(schema.jobTasks).where(eq(schema.jobTasks.companyId, args.companyId)))
        .filter((t) => jobIds.has(t.jobId));
      const tasksOut = await tasksToOut(db, args.companyId, taskRows, args.actorId);
      const tasksByJob = new Map<number, TaskOut[]>();
      for (const t of tasksOut) {
        const arr = tasksByJob.get(t.jobId) ?? [];
        arr.push(t);
        tasksByJob.set(t.jobId, arr);
      }
      let unassignedCount = 0;
      let totalTasks = 0;
      const projects = projRows.map((p) => {
        const jobs = jobRows.filter((j) => j.projectId === p.id).map((j) => {
          const crew = crewByJob.get(j.id) ?? [];
          const tasks = sortTasks(tasksByJob.get(j.id) ?? []);
          const jobUnassigned = tasks.filter((t) => t.assigneeIds.length === 0 && crew.length === 0).length;
          unassignedCount += jobUnassigned;
          totalTasks += tasks.length;
          const svc = j.serviceId != null ? svcById.get(j.serviceId) : undefined;
          return {
            jobId: j.id, jobName: j.name, serviceName: svc?.name ?? "", serviceUnit: svc?.unit ?? "",
            jobStatus: j.status, startDate: j.startDate, endDate: j.endDate,
            crew, tasks, taskTotal: tasks.length, taskDone: tasks.filter((t) => t.status === "done").length, unassignedCount: jobUnassigned,
          };
        });
        return { projectId: p.id, projectName: p.name, projectStatus: p.status, jobs };
      }).filter((p) => p.jobs.length > 0);
      return { projects, unassignedCount, totalTasks };
    },
  }),

  createProject: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), name: z.string().min(1), scope: z.string().default(""), clientId: z.number().nullable().default(null), status: z.string().default("andamento"), startDate: z.string().default(""), endDate: z.string().default(""), budget: money.default(0), estimatedValue: money.default(0), geoLat: z.number().nullable().default(null), geoLng: z.number().nullable().default(null), geoRadius: z.number().int().min(25).max(5000).default(200), streetNumber: z.string().default(""), streetName: z.string().default(""), city: z.string().default(""), state: z.string().default(""), zip: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      // Estimated value (contract price) is admin/manager only. When an actor
      // is supplied we enforce it; legacy calls without an actor keep working
      // but cannot set a non-zero estimated value.
      let estimatedValue = args.estimatedValue ?? 0;
      if (estimatedValue > 0) {
        if (args.actorId === undefined) throw new Error("Only an admin or manager can set the estimated value.");
        await requireManager(db, args.companyId, args.actorId);
      }
      if (args.clientId !== null && args.clientId !== undefined) {
        const cl = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
        if (cl.length === 0) throw new Error("Client not found in this company");
      }
      const parts = { streetNumber: args.streetNumber, streetName: args.streetName, city: args.city, state: args.state, zip: args.zip };
      const r = await db.insert(schema.projects).values({ companyId: args.companyId, name: args.name, scope: args.scope, address: formatAddress(parts), ...parts, clientId: args.clientId, status: args.status as "andamento", startDate: args.startDate, endDate: args.endDate, budget: args.budget, estimatedValue, geoLat: args.geoLat, geoLng: args.geoLng, geoRadius: args.geoRadius }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateProject: defineAction({
    request: z.object({ companyId, projectId: z.number(), actorId: z.number().optional(), status: z.string().optional(), progress: z.number().optional(), name: z.string().optional(), scope: z.string().optional(), clientId: z.number().nullable().optional(), estimatedValue: z.number().int().min(0).optional(), streetNumber: z.string().optional(), streetName: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), geoLat: z.number().nullable().optional(), geoLng: z.number().nullable().optional(), geoRadius: z.number().int().min(25).max(5000).optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      // Estimated value is admin/manager only.
      if (args.estimatedValue !== undefined) {
        if (args.actorId === undefined) throw new Error("Only an admin or manager can change the estimated value.");
        await requireManager(db, args.companyId, args.actorId);
      }
      // Client link changes also require a manager, and the client must
      // belong to the same company (or be null to clear the link).
      if (args.clientId !== undefined && args.clientId !== null) {
        const cl = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
        if (cl.length === 0) throw new Error("Client not found");
      }
      const patch: Record<string, unknown> = {};
      if (args.status !== undefined) patch.status = args.status;
      if (args.progress !== undefined) patch.progress = args.progress;
      if (args.name !== undefined) patch.name = args.name;
      if (args.scope !== undefined) patch.scope = args.scope;
      if (args.clientId !== undefined) patch.clientId = args.clientId;
      if (args.estimatedValue !== undefined) patch.estimatedValue = args.estimatedValue;
      if (args.streetNumber !== undefined) patch.streetNumber = args.streetNumber;
      if (args.streetName !== undefined) patch.streetName = args.streetName;
      if (args.city !== undefined) patch.city = args.city;
      if (args.state !== undefined) patch.state = args.state;
      if (args.zip !== undefined) patch.zip = args.zip;
      if (args.geoLat !== undefined) patch.geoLat = args.geoLat;
      if (args.geoLng !== undefined) patch.geoLng = args.geoLng;
      if (args.geoRadius !== undefined) patch.geoRadius = args.geoRadius;
      // Keep the legacy free-text column in sync with the structured parts.
      if (args.streetNumber !== undefined || args.streetName !== undefined || args.city !== undefined || args.state !== undefined || args.zip !== undefined) {
        const cur = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
        const c = cur[0];
        if (c) {
          patch.address = formatAddress({
            streetNumber: args.streetNumber ?? c.streetNumber, streetName: args.streetName ?? c.streetName,
            city: args.city ?? c.city, state: args.state ?? c.state, zip: args.zip ?? c.zip,
          });
        }
      }
      await db.update(schema.projects).set(patch).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= SERVICES CATALOG ================= */
  listServices: defineAction({
    request: z.object({ companyId }),
    response: z.object({ services: z.array(serviceOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await ensureStarterServices(db);
      const rows = await db.select().from(schema.services).where(eq(schema.services.companyId, args.companyId)).orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
      return { services: rows.map(toServiceOut) };
    },
  }),

  listServiceTypes: defineAction({
    request: z.object({ companyId }),
    response: z.object({ types: z.array(serviceTypeOut), phases: z.array(servicePhaseOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await ensureStarterServiceTypes(db);
      const types = await db.select().from(schema.serviceTypes).where(eq(schema.serviceTypes.companyId, args.companyId)).orderBy(asc(schema.serviceTypes.sortOrder), asc(schema.serviceTypes.name));
      const typeIds = types.map((t) => t.id);
      const phases = typeIds.length > 0
        ? await db.select().from(schema.servicePhases).where(inArray(schema.servicePhases.typeId, typeIds)).orderBy(asc(schema.servicePhases.phaseNumber))
        : [];
      return { types: types.map(toServiceTypeOut), phases: phases.map(toServicePhaseOut) };
    },
  }),

  createServiceType: defineAction({
    request: z.object({ companyId, actorId: z.number(), name: z.string().min(1).max(120) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cleanName = args.name.trim().replace(/\s+/g, " ");
      const existing = await db.select().from(schema.serviceTypes).where(eq(schema.serviceTypes.companyId, args.companyId));
      const maxOrder = existing.reduce((m, t) => Math.max(m, t.sortOrder), 0);
      const inserted = await db.insert(schema.serviceTypes).values({
        companyId: args.companyId, name: cleanName, sortOrder: maxOrder + 1, createdAt: new Date(),
      });
      const id = Number((inserted as unknown as { insertId: number }).insertId);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  createServicePhase: defineAction({
    request: z.object({ companyId, actorId: z.number(), typeId: z.number(), name: z.string().min(1).max(191), description: z.string().max(500).optional() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const typeRows = await db.select().from(schema.serviceTypes).where(and(eq(schema.serviceTypes.companyId, args.companyId), eq(schema.serviceTypes.id, args.typeId))).limit(1);
      if (typeRows.length === 0) throw new Error("Service type not found");
      const cleanName = args.name.trim().replace(/\s+/g, " ");
      const existing = await db.select().from(schema.servicePhases).where(eq(schema.servicePhases.typeId, args.typeId));
      const maxPhase = existing.reduce((m, p) => Math.max(m, p.phaseNumber), 0);
      const inserted = await db.insert(schema.servicePhases).values({
        typeId: args.typeId, phaseNumber: maxPhase + 1, name: cleanName,
        description: args.description?.trim() || null, createdAt: new Date(),
      });
      const id = Number((inserted as unknown as { insertId: number }).insertId);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deleteServiceType: defineAction({
    request: z.object({ companyId, actorId: z.number(), typeId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const typeRows = await db.select().from(schema.serviceTypes).where(and(eq(schema.serviceTypes.companyId, args.companyId), eq(schema.serviceTypes.id, args.typeId))).limit(1);
      if (typeRows.length === 0) throw new Error("Service type not found");
      await db.delete(schema.servicePhases).where(eq(schema.servicePhases.typeId, args.typeId));
      await db.delete(schema.serviceTypes).where(eq(schema.serviceTypes.id, args.typeId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteServicePhase: defineAction({
    request: z.object({ companyId, actorId: z.number(), phaseId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const phaseRows = await db.select().from(schema.servicePhases).where(eq(schema.servicePhases.id, args.phaseId)).limit(1);
      if (phaseRows.length === 0) throw new Error("Phase not found");
      const typeRows = await db.select().from(schema.serviceTypes).where(and(eq(schema.serviceTypes.companyId, args.companyId), eq(schema.serviceTypes.id, phaseRows[0].typeId))).limit(1);
      if (typeRows.length === 0) throw new Error("Service type not found");
      await db.delete(schema.servicePhases).where(eq(schema.servicePhases.id, args.phaseId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createService: defineAction({
    request: z.object({ companyId, actorId: z.number(), name: z.string().min(1).max(120), unit: z.string().min(1).max(60), defaultRate: money.default(0) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cleanName = args.name.trim().replace(/\s+/g, " ");
      const siblings = await db.select().from(schema.services).where(eq(schema.services.companyId, args.companyId));
      // Exact-duplicate backstop (normalized: case/space-insensitive).
      // The client pre-checks and offers "did you mean" for near matches;
      // this keeps two identical names from ever entering the catalog.
      if (siblings.some((s) => normalizeServiceName(s.name) === normalizeServiceName(cleanName))) {
        throw new Error("This service already exists.");
      }
      const sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
      const r = await db.insert(schema.services).values({ companyId: args.companyId, name: cleanName, unit: args.unit.trim(), defaultRate: args.defaultRate, sortOrder, createdAt: new Date() }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateService: defineAction({
    request: z.object({ companyId, actorId: z.number(), serviceId: z.number(), name: z.string().min(1).max(120).optional(), unit: z.string().min(1).max(60).optional(), defaultRate: z.number().int().min(0).optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId))).limit(1);
      if (!cur[0]) throw new Error("Service not found");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.unit !== undefined) patch.unit = args.unit.trim();
      if (args.defaultRate !== undefined) patch.defaultRate = args.defaultRate;
      if (Object.keys(patch).length > 0) await db.update(schema.services).set(patch).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteService: defineAction({
    request: z.object({ companyId, actorId: z.number(), serviceId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId))).limit(1);
      if (!cur[0]) throw new Error("Service not found");
      // Project measurement lines keep their snapshot (name/unit/rate), so
      // removing a catalog service never breaks a project's measurements.
      await db.delete(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ============ PROJECT SERVICES & MEASUREMENTS ============ */
  listProjectServices: defineAction({
    request: z.object({ companyId, projectId: z.number(), actorId: z.number() }),
    response: z.object({ lines: z.array(projectServiceOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertProjectReadable(db, args.companyId, args.projectId, args.actorId);
      const rows = await db.select().from(schema.projectServices)
        .where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.projectId, args.projectId)))
        .orderBy(asc(schema.projectServices.sortOrder), asc(schema.projectServices.id));
      return { lines: rows.map(toProjectServiceOut) };
    },
  }),

  addProjectService: defineAction({
    request: z.object({ companyId, actorId: z.number(), projectId: z.number(), serviceId: z.number(), quantity: z.number().positive().max(100000000) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const proj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (!proj[0]) throw new Error("Project not found");
      const svc = await db.select().from(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId))).limit(1);
      if (!svc[0]) throw new Error("Service not found in this company's catalog");
      const siblings = await db.select().from(schema.projectServices).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.projectId, args.projectId)));
      const sortOrder = siblings.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
      const r = await db.insert(schema.projectServices).values({
        companyId: args.companyId, projectId: args.projectId, serviceId: svc[0].id,
        serviceName: svc[0].name, unit: svc[0].unit, quantity: args.quantity, rate: svc[0].defaultRate,
        sortOrder, createdAt: new Date(),
      }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateProjectService: defineAction({
    request: z.object({ companyId, actorId: z.number(), lineId: z.number(), quantity: z.number().positive().max(100000000) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.projectServices).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.id, args.lineId))).limit(1);
      if (!cur[0]) throw new Error("Measurement line not found");
      await db.update(schema.projectServices).set({ quantity: args.quantity }).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.id, args.lineId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteProjectService: defineAction({
    request: z.object({ companyId, actorId: z.number(), lineId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.projectServices).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.id, args.lineId))).limit(1);
      if (!cur[0]) throw new Error("Measurement line not found");
      await db.delete(schema.projectServices).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.id, args.lineId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= PROJECT PLANS & BLUEPRINTS ================= */
  listProjectPlans: defineAction({
    request: z.object({ companyId, projectId: z.number(), actorId: z.number() }),
    response: z.object({ plans: z.array(projectPlanOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertProjectReadable(db, args.companyId, args.projectId, args.actorId);
      const rows = await db.select().from(schema.projectPlans)
        .where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.projectId, args.projectId)))
        .orderBy(desc(schema.projectPlans.id));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const em = new Map(emps.map((e) => [e.id, e.name]));
      return { plans: rows.map((r) => toProjectPlanOut(r, em.get(r.uploadedBy) ?? "")) };
    },
  }),

  getProjectPlan: defineAction({
    request: z.object({ companyId, planId: z.number(), actorId: z.number() }),
    response: z.object({ id: z.number(), name: z.string(), mimeType: z.string(), fileData: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.projectPlans).where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.id, args.planId))).limit(1);
      const r = rows[0];
      if (!r) throw new Error("Plan not found");
      await assertProjectReadable(db, args.companyId, r.projectId, args.actorId);
      return { id: r.id, name: r.name, mimeType: r.mimeType, fileData: r.fileData };
    },
  }),

  uploadProjectPlan: defineAction({
    request: z.object({
      companyId, actorId: z.number(), projectId: z.number(),
      name: z.string().min(1).max(180),
      mimeType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      fileData: z.string().min(1).max(9000000),
      thumbnailData: z.string().max(400000).default(""),
      fileSize: z.number().int().min(1).max(6291456), // 6 MB original-file cap
    }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await requireManager(db, args.companyId, args.actorId);
      const proj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (!proj[0]) throw new Error("Project not found");
      const prefix = args.mimeType === "application/pdf" ? "data:application/pdf" : `data:${args.mimeType}`;
      if (!args.fileData.startsWith(prefix)) throw new Error("That file could not be read. Please pick a PDF, JPG, or PNG plan.");
      const safeThumb = args.thumbnailData.startsWith("data:image/") ? args.thumbnailData : "";
      const r = await db.insert(schema.projectPlans).values({
        companyId: args.companyId, projectId: args.projectId, name: args.name.trim(), mimeType: args.mimeType,
        fileData: args.fileData, thumbnailData: safeThumb, fileSize: args.fileSize, uploadedBy: actor.id, createdAt: new Date(),
      }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  deleteProjectPlan: defineAction({
    request: z.object({ companyId, actorId: z.number(), planId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.projectPlans).where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.id, args.planId))).limit(1);
      if (!cur[0]) throw new Error("Plan not found");
      await db.delete(schema.projectPlans).where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.id, args.planId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= CLIENTS ================= */
  listClients: defineAction({
    request: z.object({ companyId }),
    response: z.object({ clients: z.array(clientOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const rows = await db.select().from(schema.clients).where(eq(schema.clients.companyId, args.companyId)).orderBy(asc(schema.clients.name));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const counts = new Map<number, number>();
      for (const p of projs) {
        if (p.clientId !== null) counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
      }
      return { clients: rows.map((c) => toClientOut(c, counts.get(c.id) ?? 0)) };
    },
  }),

  getClientDetail: defineAction({
    request: z.object({ companyId, clientId: z.number() }),
    response: z.object({
      client: clientOut.nullable(),
      projects: z.array(projectOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
      const client = rows[0];
      if (!client) return { client: null, projects: [] as z.infer<typeof projectOut>[] };
      const allProjects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId)).orderBy(desc(schema.projects.id));
      const mine = allProjects.filter((p) => p.clientId === args.clientId);
      const counts = new Map<number, number>();
      for (const p of allProjects) if (p.clientId !== null) counts.set(p.clientId, (counts.get(p.clientId) ?? 0) + 1);
      // Profitability per project (same calc as listProjects)
      const allSheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.status, "aprovado")));
      const allExps = await db.select().from(schema.expenses).where(eq(schema.expenses.companyId, args.companyId));
      const sheetsByProject = new Map<number, typeof allSheets>();
      for (const s of allSheets) {
        const arr = sheetsByProject.get(s.projectId) ?? [];
        arr.push(s);
        sheetsByProject.set(s.projectId, arr);
      }
      const matsByProject = new Map<number, number>();
      for (const e of allExps) matsByProject.set(e.projectId, (matsByProject.get(e.projectId) ?? 0) + Math.round(e.quantity * e.unitCost));
      return {
        client: toClientOut(client, counts.get(client.id) ?? 0),
        projects: mine.map((p) => toProjectOut(p, client.name, {
          laborCost: calcLaborCost(sheetsByProject.get(p.id) ?? []),
          materialsCost: matsByProject.get(p.id) ?? 0,
        })),
      };
    },
  }),

  createClient: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), name: z.string().min(1), contactName: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), email2: z.string().default(""), streetNumber: z.string().default(""), streetName: z.string().default(""), city: z.string().default(""), state: z.string().default(""), zip: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const parts = { streetNumber: args.streetNumber, streetName: args.streetName, city: args.city, state: args.state, zip: args.zip };
      const r = await db.insert(schema.clients).values({ companyId: args.companyId, name: args.name, contactName: args.contactName, phone: args.phone, email: args.email, email2: args.email2, address: formatAddress(parts), ...parts }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateClient: defineAction({
    request: z.object({ companyId, clientId: z.number(), actorId: z.number(), name: z.string().optional(), contactName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), email2: z.string().optional(), streetNumber: z.string().optional(), streetName: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const curRows = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
      const cur = curRows[0];
      if (!cur) throw new Error("Client not found");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.contactName !== undefined) patch.contactName = args.contactName;
      if (args.phone !== undefined) patch.phone = args.phone;
      if (args.email !== undefined) patch.email = args.email;
      if (args.email2 !== undefined) patch.email2 = args.email2;
      if (args.streetNumber !== undefined) patch.streetNumber = args.streetNumber;
      if (args.streetName !== undefined) patch.streetName = args.streetName;
      if (args.city !== undefined) patch.city = args.city;
      if (args.state !== undefined) patch.state = args.state;
      if (args.zip !== undefined) patch.zip = args.zip;
      if (args.streetNumber !== undefined || args.streetName !== undefined || args.city !== undefined || args.state !== undefined || args.zip !== undefined) {
        patch.address = formatAddress({
          streetNumber: args.streetNumber ?? cur.streetNumber, streetName: args.streetName ?? cur.streetName,
          city: args.city ?? cur.city, state: args.state ?? cur.state, zip: args.zip ?? cur.zip,
        });
      }
      await db.update(schema.clients).set(patch).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteClient: defineAction({
    request: z.object({ companyId, clientId: z.number(), actorId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
      if (!cur[0]) throw new Error("Client not found");
      const linkedProjects = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.clientId, args.clientId)));
      const linkedInvoices = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.clientId, args.clientId)));
      if (linkedProjects.length > 0 || linkedInvoices.length > 0) {
        const parts: string[] = [];
        if (linkedProjects.length > 0) parts.push(`${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"}`);
        if (linkedInvoices.length > 0) parts.push(`${linkedInvoices.length} invoice${linkedInvoices.length === 1 ? "" : "s"}`);
        throw new Error(`Cannot delete this client yet — ${parts.join(" and ")} still linked. Unlink them from the project or invoice first, then delete. Projects and invoices keep their data either way.`);
      }
      await db.delete(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= EMPLOYEES ================= */
  listEmployees: defineAction({
    request: z.object({ companyId }),
    response: z.object({ employees: z.array(employeeOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const rows = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId)).orderBy(asc(schema.employees.name));
      return { employees: rows.map((e) => ({ id: e.id, companyId: e.companyId, name: e.name, role: e.role, trade: e.trade, phone: e.phone, email: e.email, payType: e.payType, payRate: e.payRate, status: e.status, clientId: e.clientId ?? null, portalEnabled: e.portalEnabled === 1, hasPortalPassword: (e.portalPassword ?? "") !== "" })) };
    },
  }),

  createEmployee: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), name: z.string().min(1), role: z.enum(["admin", "gerente", "funcionario", "cliente"]).default("funcionario"), trade: z.string().default(""), phone: z.string().default(""), email: z.string().default(""), payType: z.enum(["hora", "diaria", "contrato"]).default("hora"), payRate: money, status: z.enum(["ativo", "inativo"]).default("ativo") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const r = await db.insert(schema.employees).values({ companyId: args.companyId, name: args.name, role: args.role, trade: args.trade, phone: args.phone, email: args.email, payType: args.payType, payRate: args.payRate, status: args.status }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateEmployee: defineAction({
    request: z.object({ companyId, employeeId: z.number(), actorId: z.number(), name: z.string().optional(), role: z.enum(["admin", "gerente", "funcionario", "cliente"]).optional(), phone: z.string().optional(), email: z.string().optional(), payType: z.enum(["hora", "diaria", "contrato"]).optional(), payRate: z.number().int().min(0).optional(), status: z.enum(["ativo", "inativo"]).optional(), trade: z.string().optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const target = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId))).limit(1);
      if (!target[0]) throw new Error("Employee not found");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.role !== undefined) patch.role = args.role;
      if (args.phone !== undefined) patch.phone = args.phone;
      if (args.email !== undefined) patch.email = args.email;
      if (args.payType !== undefined) patch.payType = args.payType;
      if (args.payRate !== undefined) patch.payRate = args.payRate;
      if (args.status !== undefined) patch.status = args.status;
      if (args.trade !== undefined) patch.trade = args.trade;
      await db.update(schema.employees).set(patch).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= ASSIGNMENTS ================= */
  listAssignments: defineAction({
    request: z.object({ companyId }),
    response: z.object({ assignments: z.array(z.object({ id: z.number(), projectId: z.number(), jobId: z.number().nullable(), employeeId: z.number() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.assignments).where(eq(schema.assignments.companyId, args.companyId));
      return { assignments: rows.map((a) => ({ id: a.id, projectId: a.projectId, jobId: a.jobId ?? null, employeeId: a.employeeId })) };
    },
  }),

  assignEmployee: defineAction({
    request: z.object({ companyId, projectId: z.number(), employeeId: z.number() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const projOk = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (projOk.length === 0) throw new Error("Project not found in this company");
      const empOk = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId))).limit(1);
      if (empOk.length === 0) throw new Error("Employee not found in this company");
      const existing = await db.select().from(schema.assignments).where(and(eq(schema.assignments.projectId, args.projectId), eq(schema.assignments.employeeId, args.employeeId))).limit(1);
      if (existing.length > 0) return { id: existing[0]!.id };
      const r = await db.insert(schema.assignments).values({ companyId: args.companyId, projectId: args.projectId, employeeId: args.employeeId }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  unassignEmployee: defineAction({
    request: z.object({ companyId, projectId: z.number(), employeeId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await db.delete(schema.assignments).where(and(eq(schema.assignments.companyId, args.companyId), eq(schema.assignments.projectId, args.projectId), eq(schema.assignments.employeeId, args.employeeId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= JOBS (trades within a project) ================= */
  createJob: defineAction({
    request: z.object({ companyId, actorId: z.number(), projectId: z.number(), name: z.string().min(1), serviceId: z.number().nullable().default(null), scope: z.string().default(""), status: z.enum(["scheduled", "in_progress", "done"]).default("scheduled"), startDate: z.string().default(""), endDate: z.string().default(""), estimatedValue: money.default(0) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const proj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (!proj[0]) throw new Error("Project not found");
      if (args.serviceId !== null) {
        const svc = await db.select().from(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId))).limit(1);
        if (!svc[0]) throw new Error("Service not found in this company");
      }
      const r = await db.insert(schema.jobs).values({ companyId: args.companyId, projectId: args.projectId, name: args.name, serviceId: args.serviceId, scope: args.scope, status: args.status, startDate: args.startDate, endDate: args.endDate, estimatedValue: args.estimatedValue }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateJob: defineAction({
    request: z.object({ companyId, actorId: z.number(), jobId: z.number(), name: z.string().optional(), serviceId: z.number().nullable().optional(), scope: z.string().optional(), status: z.enum(["scheduled", "in_progress", "done"]).optional(), startDate: z.string().optional(), endDate: z.string().optional(), estimatedValue: z.number().int().min(0).optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const cur = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId))).limit(1);
      if (!cur[0]) throw new Error("Job not found");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.serviceId !== undefined) {
        if (args.serviceId !== null) {
          const svc = await db.select().from(schema.services).where(and(eq(schema.services.companyId, args.companyId), eq(schema.services.id, args.serviceId))).limit(1);
          if (!svc[0]) throw new Error("Service not found in this company");
        }
        patch.serviceId = args.serviceId;
      }
      if (args.scope !== undefined) patch.scope = args.scope;
      if (args.status !== undefined) patch.status = args.status;
      if (args.startDate !== undefined) patch.startDate = args.startDate;
      if (args.endDate !== undefined) patch.endDate = args.endDate;
      if (args.estimatedValue !== undefined) patch.estimatedValue = args.estimatedValue;
      await db.update(schema.jobs).set(patch).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteJob: defineAction({
    request: z.object({ companyId, actorId: z.number(), jobId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      // Crew rows for this job go away; timesheets keep their history but
      // lose the job label. Project-level crew rows are untouched.
      await db.delete(schema.assignments).where(and(eq(schema.assignments.companyId, args.companyId), eq(schema.assignments.jobId, args.jobId)));
      await db.update(schema.timesheets).set({ jobId: null }).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.jobId, args.jobId)));
      const jobTasksRows = await db.select().from(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.jobId, args.jobId)));
      for (const t of jobTasksRows) {
        await db.delete(schema.taskPhotos).where(and(eq(schema.taskPhotos.companyId, args.companyId), eq(schema.taskPhotos.taskId, t.id)));
        await db.delete(schema.taskTimeLogs).where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, t.id)));
        await db.delete(schema.taskAssignees).where(and(eq(schema.taskAssignees.companyId, args.companyId), eq(schema.taskAssignees.taskId, t.id)));
      }
      await db.delete(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.jobId, args.jobId)));
      await db.delete(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Assign/unassign an employee to a specific JOB inside a project. Being on
     a job's crew also puts the employee on the project's crew (union). */
  assignJobEmployee: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), projectId: z.number(), jobId: z.number(), employeeId: z.number() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      if (args.actorId !== undefined) await requireManager(db, args.companyId, args.actorId);
      const job = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId), eq(schema.jobs.projectId, args.projectId))).limit(1);
      if (!job[0]) throw new Error("Job not found");
      const existing = await db.select().from(schema.assignments).where(and(eq(schema.assignments.projectId, args.projectId), eq(schema.assignments.jobId, args.jobId), eq(schema.assignments.employeeId, args.employeeId))).limit(1);
      if (existing.length > 0) return { id: existing[0]!.id };
      const r = await db.insert(schema.assignments).values({ companyId: args.companyId, projectId: args.projectId, jobId: args.jobId, employeeId: args.employeeId }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  unassignJobEmployee: defineAction({
    request: z.object({ companyId, projectId: z.number(), jobId: z.number(), employeeId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await db.delete(schema.assignments).where(and(eq(schema.assignments.companyId, args.companyId), eq(schema.assignments.projectId, args.projectId), eq(schema.assignments.jobId, args.jobId), eq(schema.assignments.employeeId, args.employeeId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= JOB TASKS (checklist inside each job) ================= */
  /* Every task belongs to one job. Employees work the list in any order:
     Start (To Do → In Progress) and Done (→ Done). In Progress persists
     across days until marked Done; startedAt/completedAt drive the
     "In progress • N days" display. Timesheets are untouched. */
  listTasks: defineAction({
    request: z.object({ companyId, jobId: z.number(), actorId: z.number().optional() }),
    response: z.object({ tasks: z.array(jobTaskOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const job = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId))).limit(1);
      if (!job[0]) return { tasks: [] as TaskOut[] };
      const rows = await db.select().from(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.jobId, args.jobId)));
      return { tasks: sortTasks(await tasksToOut(db, args.companyId, rows, args.actorId ?? 0)) };
    },
  }),

  createTask: defineAction({
    request: z.object({ companyId, actorId: z.number(), jobId: z.number(), title: z.string().min(1), notes: z.string().default(""), assigneeId: z.number().nullable().optional(), assigneeIds: z.array(z.number()).optional() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const job = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId))).limit(1);
      if (!job[0]) throw new Error("Job not found");
      const assigneeIds = resolveAssigneeIds(args) ?? [];
      if (assigneeIds.length > 0) {
        const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
        const valid = new Set(emps.map((e) => e.id));
        for (const id of assigneeIds) if (!valid.has(id)) throw new Error("Assignee not found in this company");
      }
      const siblings = await db.select().from(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.jobId, args.jobId)));
      const sortOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 1;
      const r = await db.insert(schema.jobTasks).values({ companyId: args.companyId, jobId: args.jobId, title: args.title.trim(), notes: args.notes, assigneeId: assigneeIds[0] ?? null, status: "todo", sortOrder, createdAt: new Date() }).$returningId();
      const taskId = r[0]!.id;
      if (assigneeIds.length > 0) await setTaskAssignees(db, args.companyId, taskId, assigneeIds);
      if (assigneeIds.length > 0) {
        await notifyUsers(db, args.companyId, assigneeIds, {
          type: "task_assigned", title: `📌 New task assigned to you: ${args.title.trim()}`,
          detail: `${job[0].name} • ${args.notes ? args.notes.slice(0, 140) : "Open the Field tab to see it in My tasks."}`,
          payload: { task: args.title.trim(), job: job[0].name, fresh: true, notes: args.notes ? args.notes.slice(0, 140) : "" },
          linkView: "field", linkId: null,
        });
      }
      ctx.invalidateQueries();
      return { id: taskId };
    },
  }),

  updateTask: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number(), title: z.string().min(1).optional(), notes: z.string().optional(), assigneeId: z.number().nullable().optional(), assigneeIds: z.array(z.number()).optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const taskBefore = await requireTask(db, args.companyId, args.taskId);
      const beforeIds = await taskAssigneeIds(db, args.companyId, taskBefore);
      const nextIds = resolveAssigneeIds(args);
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = args.title.trim();
      if (args.notes !== undefined) patch.notes = args.notes;
      if (Object.keys(patch).length > 0) await db.update(schema.jobTasks).set(patch).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.id, args.taskId)));
      if (nextIds !== undefined) {
        await setTaskAssignees(db, args.companyId, args.taskId, nextIds);
        const newlyAdded = nextIds.filter((id) => !beforeIds.includes(id));
        if (newlyAdded.length > 0) {
          const jobRow = await db.select().from(schema.jobs).where(eq(schema.jobs.id, taskBefore.jobId)).limit(1);
          await notifyUsers(db, args.companyId, newlyAdded, {
            type: "task_assigned", title: `📌 Task assigned to you: ${taskBefore.title}`,
            detail: jobRow[0] ? `${jobRow[0].name} • Open the Field tab to see it in My tasks.` : "Open the Field tab to see it in My tasks.",
            payload: { task: taskBefore.title, job: jobRow[0]?.name ?? "", fresh: false, notes: "" },
            linkView: "field", linkId: null,
          });
        }
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteTask: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await requireTask(db, args.companyId, args.taskId);
      await db.delete(schema.taskPhotos).where(and(eq(schema.taskPhotos.companyId, args.companyId), eq(schema.taskPhotos.taskId, args.taskId)));
      await db.delete(schema.taskTimeLogs).where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId)));
      await db.delete(schema.taskAssignees).where(and(eq(schema.taskAssignees.companyId, args.companyId), eq(schema.taskAssignees.taskId, args.taskId)));
      await db.delete(schema.jobTasks).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.id, args.taskId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Status moves: employees may move tasks they can see (assigned to them or
     whole-crew tasks on their jobs); managers can move any task, including
     back to To Do (which clears start/finish stamps). */
  setTaskStatus: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number(), status: z.enum(["todo", "in_progress", "done"]) }),
    response: z.object({ ok: z.literal(true), status: z.string(), startedAt: z.string().nullable(), completedAt: z.string().nullable() }),
    async handler(ctx, args): Promise<{ ok: true; status: string; startedAt: string | null; completedAt: string | null }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const task = await requireTask(db, args.companyId, args.taskId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      const isManagerActor = actor[0] && (actor[0].role === "admin" || actor[0].role === "gerente");
      if (!isManagerActor && !(await taskVisibleTo(db, args.companyId, args.actorId, task))) {
        throw new Error("This task is not assigned to you.");
      }
      const now = new Date();
      const patch: { status: "todo" | "in_progress" | "done"; startedAt: Date | null; completedAt: Date | null } = { status: args.status, startedAt: task.startedAt, completedAt: task.completedAt };
      if (args.status === "in_progress") {
        patch.startedAt = task.startedAt ?? now; // first start wins: multi-day work keeps its original start
        patch.completedAt = null;
      } else if (args.status === "done") {
        patch.startedAt = task.startedAt ?? now;
        patch.completedAt = now;
      } else {
        patch.startedAt = null;
        patch.completedAt = null;
      }
      await db.update(schema.jobTasks).set(patch).where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.id, args.taskId)));
      if (args.status === "done") {
        // Closing a task stops any work timer still running on it.
        const openLogs = await db.select().from(schema.taskTimeLogs)
          .where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId)));
        for (const l of openLogs) {
          if (l.endedAt === null && l.startedAt !== null) {
            const mins = Math.round(((now.getTime() - l.startedAt.getTime()) / 60000) * 10) / 10;
            await db.update(schema.taskTimeLogs).set({ endedAt: now, minutes: l.minutes + Math.max(0, mins) }).where(eq(schema.taskTimeLogs.id, l.id));
          }
        }
        if (task.status !== "done") {
          const jobRow = await db.select().from(schema.jobs).where(eq(schema.jobs.id, task.jobId)).limit(1);
          const actorRow = await db.select().from(schema.employees).where(eq(schema.employees.id, args.actorId)).limit(1);
          await notifyManagers(db, args.companyId, {
            type: "task_done", title: `✅ Task done: ${task.title}`,
            detail: `${jobRow[0]?.name ?? "Job"} • finished by ${actorRow[0]?.name ?? "crew"}.`,
            payload: { task: task.title, job: jobRow[0]?.name ?? "Job", actor: actorRow[0]?.name ?? "crew" },
            linkView: "projects", linkId: jobRow[0]?.projectId ?? null,
            dedupeKey: `taskdone:${task.id}:${now.getTime()}`,
          });
        }
      }
      ctx.invalidateQueries();
      return { ok: true as const, status: args.status, startedAt: patch.startedAt?.toISOString() ?? null, completedAt: patch.completedAt?.toISOString() ?? null };
    },
  }),

  /* The field worker's task list: everything assigned to them plus
     whole-crew tasks on their jobs, across their active projects. Done jobs
     and completed projects drop off so the list stays focused. */
  getMyTasks: defineAction({
    request: z.object({ companyId, employeeId: z.number() }),
    response: z.object({ tasks: z.array(jobTaskOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const all = await db.select().from(schema.jobTasks).where(eq(schema.jobTasks.companyId, args.companyId));
      const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, args.companyId));
      const jobById = new Map(jobs.map((j) => [j.id, j]));
      const projects = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const projById = new Map(projects.map((p) => [p.id, p]));
      const mine: JobTaskRow[] = [];
      for (const t of all) {
        const job = jobById.get(t.jobId);
        if (!job || job.status === "done") continue;
        const proj = projById.get(job.projectId);
        if (!proj || proj.status === "concluida") continue;
        if (await taskVisibleTo(db, args.companyId, args.employeeId, t)) mine.push(t);
      }
      return { tasks: sortTasks(await tasksToOut(db, args.companyId, mine, args.employeeId)) };
    },
  }),

  /* Task photos: same inline-image rule as project progress photos — only
     data:image/ payloads captured on the device are accepted. */
  addTaskPhoto: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number(), photoData: z.string(), stage: z.enum(["before", "during", "after"]).default("during") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const task = await requireTask(db, args.companyId, args.taskId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      const isManagerActor = actor[0] && (actor[0].role === "admin" || actor[0].role === "gerente");
      if (!isManagerActor && !(await taskVisibleTo(db, args.companyId, args.actorId, task))) {
        throw new Error("This task is not assigned to you.");
      }
      if (!args.photoData.startsWith("data:image/")) throw new Error("Only photos captured on the device can be attached.");
      const r = await db.insert(schema.taskPhotos).values({ companyId: args.companyId, taskId: args.taskId, employeeId: args.actorId, photoUrl: args.photoData, stage: args.stage, createdAt: new Date() }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  /* ================= FIELD: CHECK-IN / OUT ================= */
  getActiveSheet: defineAction({
    request: z.object({ companyId, employeeId: z.number() }),
    response: z.object({ sheet: timesheetOut.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await applyAutoClose(db, args.companyId);
      const rows = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.employeeId, args.employeeId), eq(schema.timesheets.status, "aberto"))).orderBy(desc(schema.timesheets.id)).limit(1);
      const s = rows[0];
      if (!s) return { sheet: null };
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).limit(1);
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.id, s.employeeId)).limit(1);
      const jm = await jobNameMap(db, args.companyId);
      return { sheet: toSheetOut(s, projs[0]?.name ?? "", emps[0]?.name ?? "", s.jobId !== null ? (jm.get(s.jobId) ?? "") : "") };
    },
  }),

  checkIn: defineAction({
    request: z.object({ companyId, projectId: z.number(), jobId: z.number().nullable().default(null), employeeId: z.number(), lat: z.number().nullable().default(null), lng: z.number().nullable().default(null), manualNote: z.string().default("") }),
    response: z.object({ id: z.number(), zone: z.string(), distM: z.number().nullable(), projectName: z.string(), jobName: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await applyAutoClose(db, args.companyId);
      const projRows = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      const proj = projRows[0];
      if (!proj) throw new Error("Project not found");
      const empRows = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId))).limit(1);
      const emp = empRows[0];
      if (!emp) throw new Error("Employee not found");
      // The picked job must belong to this project; anything else is ignored.
      let job: typeof schema.jobs.$inferSelect | undefined;
      if (args.jobId !== null) {
        const jr = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.id, args.jobId), eq(schema.jobs.projectId, args.projectId))).limit(1);
        job = jr[0];
      }
      const zr = zoneFor(proj, args.lat, args.lng);
      const now = new Date();
      const noteParts = [args.manualNote];
      if (zr.zone === "fora") noteParts.push("OUTSIDE JOB SITE AREA at check-in — awaiting manager review.");
      const r = await db.insert(schema.timesheets).values({
        companyId: args.companyId, projectId: args.projectId, jobId: job?.id ?? null, employeeId: args.employeeId,
        checkInAt: now, inLat: args.lat, inLng: args.lng,
        inZone: zr.zone, inDistM: zr.distM,
        status: "aberto", note: noteParts.filter(Boolean).join(" "), workDate: todayStr(), hoursCalc: 0,
        payTypeSnapshot: emp.payType, payRateSnapshot: emp.payRate,
      }).$returningId();
      const sheetId = r[0]!.id;
      if (args.lat !== null && args.lng !== null) {
        await db.insert(schema.locationPings).values({ companyId: args.companyId, timesheetId: sheetId, employeeId: args.employeeId, lat: args.lat, lng: args.lng, distM: zr.distM, zone: zr.zone, createdAt: now });
      }
      if (zr.zone === "fora") {
        await notifyManagers(db, args.companyId, {
          type: "out_of_zone", title: "🚨 Check-in outside job site area",
          detail: `${emp.name} checked in${zr.distM !== null ? ` ${zr.distM} m from the site center` : ""} at ${proj.name}${job ? ` (${job.name})` : ""}. Review before approving.`,
          payload: { phase: "in", name: emp.name, distM: zr.distM, project: proj.name, job: job?.name ?? "" },
          linkView: "entries", linkId: sheetId, dedupeKey: `zone-in:${sheetId}`,
        });
      }
      ctx.invalidateQueries();
      return { id: sheetId, zone: zr.zone, distM: zr.distM, projectName: proj.name, jobName: job?.name ?? "" };
    },
  }),

  checkOut: defineAction({
    request: z.object({ companyId, sheetId: z.number(), lat: z.number().nullable().default(null), lng: z.number().nullable().default(null) }),
    response: z.object({ ok: z.literal(true), hours: z.number(), zone: z.string(), distM: z.number().nullable(), autoClosed: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; hours: number; zone: string; distM: number | null; autoClosed: boolean }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await applyAutoClose(db, args.companyId);
      const rows = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId))).limit(1);
      const s = rows[0];
      if (!s) throw new Error("Time entry not found");
      if (s.checkOutAt) throw new Error("This entry is already closed");
      const projRows = await db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).limit(1);
      const zr = zoneFor(projRows[0], args.lat, args.lng);
      const settings = await getSettings(db, args.companyId);
      const now = new Date();
      const cutoff = hhmmToDate(s.workDate, settings.autoCloseTime);
      // Nenhuma hora é contada após o horário-limite (17:00); gerente pode estender via ajuste.
      const capped = now.getTime() > cutoff.getTime();
      const effectiveEnd = capped ? cutoff : now;
      const hrs = Math.max(0, Math.round(((effectiveEnd.getTime() - s.checkInAt.getTime()) / 3600000) * 100) / 100);
      const noteParts = [s.note];
      if (capped) noteParts.push(`Check-out recorded after ${settings.autoCloseTime} — hours counted up to ${settings.autoCloseTime}.`);
      if (zr.zone === "fora") noteParts.push("OUTSIDE JOB SITE AREA at check-out — awaiting manager review.");
      await db.update(schema.timesheets).set({
        checkOutAt: effectiveEnd, outLat: args.lat, outLng: args.lng,
        outZone: zr.zone, outDistM: zr.distM,
        hoursCalc: hrs, status: "pendente", autoClosed: capped ? 1 : 0,
        note: noteParts.filter(Boolean).join(" "),
      }).where(eq(schema.timesheets.id, args.sheetId));
      if (args.lat !== null && args.lng !== null) {
        await db.insert(schema.locationPings).values({ companyId: args.companyId, timesheetId: args.sheetId, employeeId: s.employeeId, lat: args.lat, lng: args.lng, distM: zr.distM, zone: zr.zone, createdAt: now });
      }
      const empOut = await db.select().from(schema.employees).where(eq(schema.employees.id, s.employeeId)).limit(1);
      if (zr.zone === "fora") {
        await notifyManagers(db, args.companyId, {
          type: "out_of_zone", title: "🚨 Check-out outside job site area",
          detail: `${empOut[0]?.name ?? "Employee"} checked out${zr.distM !== null ? ` ${zr.distM} m from the site center` : ""} (${projRows[0]?.name ?? "project"}). Review before approving.`,
          payload: { phase: "out", name: empOut[0]?.name ?? "Employee", distM: zr.distM, project: projRows[0]?.name ?? "project", job: "" },
          linkView: "entries", linkId: args.sheetId, dedupeKey: `zone-out:${args.sheetId}`,
        });
      }
      await notifyManagers(db, args.companyId, {
        type: "timesheet_pending", title: "🕐 Timesheet pending approval",
        detail: `${empOut[0]?.name ?? "Employee"} • ${s.workDate} • ${hrs.toFixed(1)}h${capped ? " (auto-closed at the cutoff)" : ""}.`,
        payload: { name: empOut[0]?.name ?? "Employee", date: s.workDate, hours: hrs.toFixed(1), autoAt: capped ? "cutoff" : null },
        linkView: "entries", linkId: args.sheetId, dedupeKey: `pending:${args.sheetId}`,
      });
      ctx.invalidateQueries();
      return { ok: true as const, hours: hrs, zone: zr.zone, distM: zr.distM, autoClosed: capped };
    },
  }),

  /* Trilha de GPS: posição a cada 30 min ENQUANTO o app está aberto.
     Um web app não consegue enviar localização com o celular bloqueado ou
     o app fechado (iOS/Android suspendem a página); o rastreamento em
     segundo plano de verdade exige o app nativo numa próxima fase. */
  recordPing: defineAction({
    request: z.object({ companyId, employeeId: z.number(), sheetId: z.number().nullable().default(null), lat: z.number(), lng: z.number() }),
    response: z.object({ ok: z.literal(true), zone: z.string(), distM: z.number().nullable(), at: z.string() }),
    async handler(ctx, args): Promise<{ ok: true; zone: string; distM: number | null; at: string }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      let proj: typeof schema.projects.$inferSelect | undefined;
      if (args.sheetId !== null) {
        const s = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId))).limit(1);
        if (s[0]) {
          const p = await db.select().from(schema.projects).where(eq(schema.projects.id, s[0].projectId)).limit(1);
          proj = p[0];
        }
      }
      const zr = zoneFor(proj, args.lat, args.lng);
      const now = new Date();
      await db.insert(schema.locationPings).values({ companyId: args.companyId, timesheetId: args.sheetId, employeeId: args.employeeId, lat: args.lat, lng: args.lng, distM: zr.distM, zone: zr.zone, createdAt: now });
      return { ok: true as const, zone: zr.zone, distM: zr.distM, at: now.toISOString() };
    },
  }),

  getMyToday: defineAction({
    request: z.object({ companyId, employeeId: z.number() }),
    response: z.object({
      todayProject: z.object({ id: z.number(), name: z.string(), scope: z.string(), address: z.string(), geoLat: z.number().nullable(), geoLng: z.number().nullable(), geoRadius: z.number() }).nullable(),
      todayJobs: z.array(z.object({
        jobId: z.number(), jobName: z.string(), scope: z.string(), status: z.string(),
        startDate: z.string(), endDate: z.string(),
        projectId: z.number(), projectName: z.string(), projectScope: z.string(), projectAddress: z.string(),
        geoLat: z.number().nullable(), geoLng: z.number().nullable(), geoRadius: z.number(),
      })),
      assignedProjects: z.array(z.object({ id: z.number(), name: z.string(), scope: z.string() })),
      activeSheet: timesheetOut.nullable(),
      todaySheets: z.array(timesheetOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await applyAutoClose(db, args.companyId);
      const assigns = await db.select().from(schema.assignments).where(and(eq(schema.assignments.companyId, args.companyId), eq(schema.assignments.employeeId, args.employeeId)));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const pm = new Map(projs.map((p) => [p.id, p]));
      const mine = assigns.map((a) => pm.get(a.projectId)).filter((p): p is NonNullable<typeof p> => !!p && p.status !== "concluida");
      const td = todayStr();

      // --- "Job for today": specific job assignments first. A job counts for
      // today when it isn't done and (when dated) today is inside its dates.
      const myJobAssigns = assigns.filter((a) => a.jobId !== null && a.jobId !== undefined);
      let todayJobs: Array<{ jobId: number; jobName: string; scope: string; status: string; startDate: string; endDate: string; projectId: number; projectName: string; projectScope: string; projectAddress: string; geoLat: number | null; geoLng: number | null; geoRadius: number }> = [];
      if (myJobAssigns.length > 0) {
        const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, args.companyId));
        const jmById = new Map(allJobs.map((j) => [j.id, j]));
        const statusRank = (s: string) => (s === "in_progress" ? 0 : s === "scheduled" ? 1 : 2);
        todayJobs = myJobAssigns
          .map((a) => {
            const job = a.jobId !== null ? jmById.get(a.jobId) : undefined;
            if (!job) return null;
            const proj = pm.get(job.projectId);
            if (!proj || proj.status === "concluida") return null;
            if (job.status === "done") return null;
            if (job.startDate && job.startDate > td) return null;
            if (job.endDate && job.endDate < td) return null;
            return {
              jobId: job.id, jobName: job.name, scope: job.scope, status: job.status,
              startDate: job.startDate, endDate: job.endDate,
              projectId: proj.id, projectName: proj.name, projectScope: proj.scope, projectAddress: proj.address,
              geoLat: proj.geoLat, geoLng: proj.geoLng, geoRadius: proj.geoRadius,
            };
          })
          .filter((j): j is NonNullable<typeof j> => j !== null)
          .sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.startDate.localeCompare(b.startDate) || a.jobId - b.jobId);
      }

      // Fallback: project-level assignment picks today's site.
      const jobProject = todayJobs[0] ? pm.get(todayJobs[0].projectId) : undefined;
      const todayProj = jobProject ?? (mine.find((p) => p.status === "andamento") ?? mine[0] ?? null);
      const sheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.employeeId, args.employeeId), eq(schema.timesheets.workDate, td))).orderBy(desc(schema.timesheets.id));
      const activeRows = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.employeeId, args.employeeId), eq(schema.timesheets.status, "aberto"))).orderBy(desc(schema.timesheets.id)).limit(1);
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.id, args.employeeId)).limit(1);
      const empName = emps[0]?.name ?? "";
      const jm = await jobNameMap(db, args.companyId);
      return {
        todayProject: todayProj ? { id: todayProj.id, name: todayProj.name, scope: todayProj.scope, address: todayProj.address, geoLat: todayProj.geoLat, geoLng: todayProj.geoLng, geoRadius: todayProj.geoRadius } : null,
        todayJobs,
        assignedProjects: mine.map((p) => ({ id: p.id, name: p.name, scope: p.scope })),
        activeSheet: activeRows[0] ? toSheetOut(activeRows[0], pm.get(activeRows[0].projectId)?.name ?? "", empName, activeRows[0].jobId !== null ? (jm.get(activeRows[0].jobId) ?? "") : "") : null,
        todaySheets: sheets.map((s) => toSheetOut(s, pm.get(s.projectId)?.name ?? "", empName, s.jobId !== null ? (jm.get(s.jobId) ?? "") : "")),
      };
    },
  }),

  /* ================= PROGRESS ================= */
  createProgress: defineAction({
    request: z.object({ companyId, projectId: z.number(), employeeId: z.number(), note: z.string().default(""), photoUrl: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const projOk = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (projOk.length === 0) throw new Error("Project not found in this company");
      // Only inline image data is accepted (captured via FileReader on device).
      // External URLs are rejected so a stored value can never make another
      // viewer's browser contact an arbitrary host.
      const safePhoto = args.photoUrl.startsWith("data:image/") ? args.photoUrl : "";
      const r = await db.insert(schema.progressUpdates).values({ companyId: args.companyId, projectId: args.projectId, employeeId: args.employeeId, note: args.note, photoUrl: safePhoto, createdAt: new Date() }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  listProgress: defineAction({
    request: z.object({ companyId, projectId: z.number().optional() }),
    response: z.object({ items: z.array(z.object({ id: z.number(), projectId: z.number(), projectName: z.string(), note: z.string(), photoUrl: z.string(), employeeName: z.string(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      let rows = await db.select().from(schema.progressUpdates).where(eq(schema.progressUpdates.companyId, args.companyId)).orderBy(desc(schema.progressUpdates.id)).limit(50);
      if (args.projectId !== undefined) rows = rows.filter((r) => r.projectId === args.projectId);
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const pm = new Map(projs.map((p) => [p.id, p.name]));
      const em = new Map(emps.map((e) => [e.id, e.name]));
      return { items: rows.map((r) => ({ id: r.id, projectId: r.projectId, projectName: pm.get(r.projectId) ?? "", note: r.note, photoUrl: r.photoUrl, employeeName: em.get(r.employeeId) ?? "", createdAt: r.createdAt.toISOString() })) };
    },
  }),

  /* ================= TIMESHEETS ================= */
  listTimesheets: defineAction({
    request: z.object({ companyId, employeeId: z.number().optional(), projectId: z.number().optional(), status: z.string().optional(), weekOnly: z.boolean().default(false) }),
    response: z.object({ sheets: z.array(timesheetOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await applyAutoClose(db, args.companyId);
      let rows = await db.select().from(schema.timesheets).where(eq(schema.timesheets.companyId, args.companyId)).orderBy(desc(schema.timesheets.id)).limit(200);
      if (args.employeeId !== undefined) rows = rows.filter((r) => r.employeeId === args.employeeId);
      if (args.projectId !== undefined) rows = rows.filter((r) => r.projectId === args.projectId);
      if (args.status) rows = rows.filter((r) => r.status === args.status);
      if (args.weekOnly) {
        const wb = weekBounds();
        rows = rows.filter((r) => r.workDate >= wb.start && r.workDate <= wb.end);
      }
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const pm = new Map(projs.map((p) => [p.id, p.name]));
      const em = new Map(emps.map((e) => [e.id, e.name]));
      const jm = await jobNameMap(db, args.companyId);
      return { sheets: rows.map((s) => toSheetOut(s, pm.get(s.projectId) ?? "", em.get(s.employeeId) ?? "", s.jobId !== null ? (jm.get(s.jobId) ?? "") : "")) };
    },
  }),

  setSheetStatus: defineAction({
    request: z.object({ companyId, sheetId: z.number(), status: z.string(), actorId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      if (!actor[0] || (actor[0].role !== "admin" && actor[0].role !== "gerente")) {
        throw new Error("Only a manager or admin can approve/reject time entries.");
      }
      if (!["aprovado", "rejeitado", "pendente"].includes(args.status)) throw new Error("Invalid status");
      const sheetRow = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId))).limit(1);
      if (!sheetRow[0]) throw new Error("Time entry not found");
      if (await paidLockFor(db, args.companyId, sheetRow[0].employeeId, sheetRow[0].workDate)) {
        throw new Error("This entry is in a paid payroll period and is locked. Paid periods can't be changed.");
      }
      await db.update(schema.timesheets).set({ status: args.status as "aprovado" }).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Detalhe do registro: trilha de GPS + histórico de ajustes */
  getSheetDetail: defineAction({
    request: z.object({ companyId, sheetId: z.number() }),
    response: z.object({
      sheet: timesheetOut.nullable(),
      trail: z.array(z.object({ id: z.number(), lat: z.number(), lng: z.number(), distM: z.number().nullable(), zone: z.string(), at: z.string() })),
      adjustments: z.array(z.object({ id: z.number(), adjustedByName: z.string(), oldIn: z.string(), newIn: z.string(), oldOut: z.string().nullable(), newOut: z.string().nullable(), oldHours: z.number(), newHours: z.number(), reason: z.string(), at: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const rows = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId))).limit(1);
      const s = rows[0];
      if (!s) return { sheet: null, trail: [], adjustments: [] };
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).limit(1);
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.id, s.employeeId)).limit(1);
      const jm = await jobNameMap(db, args.companyId);
      const pings = await db.select().from(schema.locationPings).where(eq(schema.locationPings.timesheetId, args.sheetId)).orderBy(asc(schema.locationPings.id));
      const adjs = await db.select().from(schema.timesheetAdjustments).where(eq(schema.timesheetAdjustments.timesheetId, args.sheetId)).orderBy(desc(schema.timesheetAdjustments.id));
      return {
        sheet: toSheetOut(s, projs[0]?.name ?? "", emps[0]?.name ?? "", s.jobId !== null ? (jm.get(s.jobId) ?? "") : ""),
        trail: pings.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, distM: p.distM, zone: p.zone, at: p.createdAt.toISOString() })),
        adjustments: adjs.map((a) => ({ id: a.id, adjustedByName: a.adjustedByName, oldIn: a.oldCheckInAt.toISOString(), newIn: a.newCheckInAt.toISOString(), oldOut: a.oldCheckOutAt?.toISOString() ?? null, newOut: a.newCheckOutAt?.toISOString() ?? null, oldHours: a.oldHours, newHours: a.newHours, reason: a.reason, at: a.createdAt.toISOString() })),
      };
    },
  }),

  /* Ajuste de horários: SOMENTE gerente/admin. Funcionário nunca edita as
     próprias horas. Cada ajuste grava quem, quando, valor antigo e novo. */
  adjustSheet: defineAction({
    request: z.object({ companyId, sheetId: z.number(), actorId: z.number(), newCheckInAt: z.string(), newCheckOutAt: z.string().nullable(), reason: z.string().default("") }),
    response: z.object({ ok: z.literal(true), hours: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; hours: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      const a = actor[0];
      if (!a || (a.role !== "admin" && a.role !== "gerente")) {
        throw new Error("Only a manager or admin can adjust times.");
      }
      const rows = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.id, args.sheetId))).limit(1);
      const s = rows[0];
      if (!s) throw new Error("Time entry not found");
      if (await paidLockFor(db, args.companyId, s.employeeId, s.workDate)) {
        throw new Error("This entry is in a paid payroll period and is locked. Paid periods can't be changed.");
      }
      const newIn = new Date(args.newCheckInAt);
      const newOut = args.newCheckOutAt ? new Date(args.newCheckOutAt) : null;
      if (Number.isNaN(newIn.getTime()) || (newOut && Number.isNaN(newOut.getTime()))) throw new Error("Invalid time");
      if (newOut && newOut.getTime() < newIn.getTime()) throw new Error("Check-out cannot be before check-in");
      const newHours = newOut ? Math.round(((newOut.getTime() - newIn.getTime()) / 3600000) * 100) / 100 : 0;
      await db.insert(schema.timesheetAdjustments).values({
        companyId: args.companyId, timesheetId: args.sheetId,
        adjustedBy: a.id, adjustedByName: a.name,
        oldCheckInAt: s.checkInAt, newCheckInAt: newIn,
        oldCheckOutAt: s.checkOutAt, newCheckOutAt: newOut,
        oldHours: s.hoursCalc, newHours, reason: args.reason, createdAt: new Date(),
      });
      await db.update(schema.timesheets).set({ checkInAt: newIn, checkOutAt: newOut, hoursCalc: newHours, workDate: `${newIn.getFullYear()}-${String(newIn.getMonth() + 1).padStart(2, "0")}-${String(newIn.getDate()).padStart(2, "0")}` }).where(eq(schema.timesheets.id, args.sheetId));
      ctx.invalidateQueries();
      return { ok: true as const, hours: newHours };
    },
  }),

  /* ================= COMPANY PROFILE (invoice header) ================= */
  getCompanyProfile: defineAction({
    request: z.object({ companyId }),
    response: z.object({ profile: companyProfileOut.nullable() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      const c = rows[0];
      if (!c) return { profile: null };
      return { profile: toCompanyProfile(c) };
    },
  }),

  updateCompanyProfile: defineAction({
    request: z.object({ companyId, actorId: z.number(), name: z.string().min(1), phone: z.string().default(""), email: z.string().default(""), streetNumber: z.string().default(""), streetName: z.string().default(""), city: z.string().default(""), state: z.string().default(""), zip: z.string().default(""), invoiceAccentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default(DEFAULT_INVOICE_ACCENT), logoDataUrl: z.string().max(1200000).default("") }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      if (!actor[0] || actor[0].role !== "admin") throw new Error("Only an admin can edit the company profile.");
      const logoUrl = args.logoDataUrl === "" || args.logoDataUrl.startsWith("data:image/") ? args.logoDataUrl : "";
      if (args.logoDataUrl !== "" && !args.logoDataUrl.startsWith("data:image/")) throw new Error("Logo must be an image file.");
      const parts = { streetNumber: args.streetNumber, streetName: args.streetName, city: args.city, state: args.state, zip: args.zip };
      await db.update(schema.companies).set({ name: args.name, phone: args.phone, email: args.email, ...parts, address: formatAddress(parts), invoiceAccentColor: normalizeInvoiceAccent(args.invoiceAccentColor), logoUrl }).where(eq(schema.companies.id, args.companyId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  suggestInvoiceNumber: defineAction({
    request: z.object({ companyId, issueDate: z.string() }),
    response: z.object({ number: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      // Pattern like Giglio 0708-24: MMDD-YY from the issue date.
      const d = new Date(`${args.issueDate}T12:00:00`);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(-2);
      const base = `${mm}${dd}-${yy}`;
      const existing = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      const taken = new Set(existing.map((i) => i.number));
      if (!taken.has(base)) return { number: base };
      let n = 2;
      while (taken.has(`${base}-${n}`)) n++;
      return { number: `${base}-${n}` };
    },
  }),

  /* ================= REGRAS DE PONTO / ALERTAS ================= */
  getSettings: defineAction({
    request: z.object({ companyId }),
    response: z.object({ noShowCutoff: z.string(), autoCloseTime: z.string(), otEnabled: z.boolean(), otDailyHours: z.number(), otWeeklyHours: z.number(), otMultiplier: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      return getSettings(db, args.companyId);
    },
  }),

  updateSettings: defineAction({
    request: z.object({
      companyId, actorId: z.number(),
      noShowCutoff: z.string().regex(/^\d{2}:\d{2}$/), autoCloseTime: z.string().regex(/^\d{2}:\d{2}$/),
      otEnabled: z.boolean().optional(), otDailyHours: z.number().min(0).max(24).optional(),
      otWeeklyHours: z.number().min(0).max(168).optional(), otMultiplier: z.number().min(1).max(5).optional(),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      if (!actor[0] || (actor[0].role !== "admin" && actor[0].role !== "gerente")) {
        throw new Error("Only a manager or admin can change the time-clock rules.");
      }
      const patch: Record<string, unknown> = { noShowCutoff: args.noShowCutoff, autoCloseTime: args.autoCloseTime };
      if (args.otEnabled !== undefined) patch.otEnabled = args.otEnabled ? 1 : 0;
      if (args.otDailyHours !== undefined) patch.otDailyHours = args.otDailyHours;
      if (args.otWeeklyHours !== undefined) patch.otWeeklyHours = args.otWeeklyHours;
      if (args.otMultiplier !== undefined) patch.otMultiplier = args.otMultiplier;
      const existing = await db.select().from(schema.companySettings).where(eq(schema.companySettings.companyId, args.companyId)).limit(1);
      if (existing.length > 0) {
        await db.update(schema.companySettings).set(patch).where(eq(schema.companySettings.companyId, args.companyId));
      } else {
        await db.insert(schema.companySettings).values({ companyId: args.companyId, noShowCutoff: args.noShowCutoff, autoCloseTime: args.autoCloseTime, otEnabled: args.otEnabled ? 1 : 0, otDailyHours: args.otDailyHours ?? 8, otWeeklyHours: args.otWeeklyHours ?? 40, otMultiplier: args.otMultiplier ?? 1.5 });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Alertas do gerente: fora da área, sem registro, em campo agora */
  getManagerAlerts: defineAction({
    request: z.object({ companyId }),
    response: z.object({
      noShowCutoff: z.string(), autoCloseTime: z.string(),
      outOfZone: z.array(z.object({ sheetId: z.number(), employeeName: z.string(), projectName: z.string(), workDate: z.string(), where: z.string(), distM: z.number().nullable() })),
      noShows: z.array(z.object({ employeeId: z.number(), employeeName: z.string(), projectName: z.string() })),
      openNow: z.array(z.object({ sheetId: z.number(), employeeName: z.string(), projectName: z.string(), since: z.string() })),
      autoClosedToday: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await applyAutoClose(db, args.companyId);
      const settings = await getSettings(db, args.companyId);
      const td = todayStr();
      const now = new Date();
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const empMap = new Map(emps.map((e) => [e.id, e.name]));
      const projMap = new Map(projs.map((p) => [p.id, p.name]));

      // Registros sinalizados FORA DA ÁREA aguardando decisão do gerente
      // (abertos = alerta imediato; pendentes = aguardando aprovação)
      const flagged = (await db.select().from(schema.timesheets).where(eq(schema.timesheets.companyId, args.companyId)))
        .filter((s) => s.status === "pendente" || s.status === "aberto");
      const outOfZone = flagged
        .filter((s) => s.inZone === "fora" || s.outZone === "fora")
        .map((s) => {
          const atIn = s.inZone === "fora";
          return { sheetId: s.id, employeeName: empMap.get(s.employeeId) ?? "", projectName: projMap.get(s.projectId) ?? "", workDate: s.workDate, where: atIn ? "check-in" : "check-out", distM: atIn ? s.inDistM : s.outDistM };
        });

      // SEM REGISTRO: tem obra atribuída hoje e nenhum check-in até o horário-limite.
      // Atribuição via JOB conta como atribuição à obra; um job já concluído
      // ou fora do seu período (start/end) não gera expectativa de check-in.
      const cutoffPassed = now.getTime() >= hhmmToDate(td, settings.noShowCutoff).getTime();
      const noShows: { employeeId: number; employeeName: string; projectName: string }[] = [];
      if (cutoffPassed) {
        const assigns = await db.select().from(schema.assignments).where(eq(schema.assignments.companyId, args.companyId));
        const allJobs = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, args.companyId));
        const jobMap = new Map(allJobs.map((j) => [j.id, j]));
        const todaySheets = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.workDate, td)));
        const checkedIn = new Set(todaySheets.map((s) => s.employeeId));
        const projStatus = new Map(projs.map((p) => [p.id, p.status]));
        const expectedOnProject = new Map<number, number>(); // employeeId -> projectId
        for (const a of assigns) {
          if (expectedOnProject.has(a.employeeId)) continue;
          if (a.jobId !== null && a.jobId !== undefined) {
            const job = jobMap.get(a.jobId);
            if (!job) continue;
            if (job.status === "done") continue;
            if (job.startDate && job.startDate > td) continue;
            if (job.endDate && job.endDate < td) continue;
          }
          expectedOnProject.set(a.employeeId, a.projectId);
        }
        const seen = new Set<number>();
        for (const a of assigns) {
          if (projStatus.get(a.projectId) === "concluida") continue;
          if (checkedIn.has(a.employeeId) || seen.has(a.employeeId)) continue;
          if (!expectedOnProject.has(a.employeeId)) continue;
          const emp = emps.find((e) => e.id === a.employeeId);
          if (!emp || emp.status !== "ativo" || emp.role !== "funcionario") continue;
          seen.add(a.employeeId);
          noShows.push({ employeeId: a.employeeId, employeeName: emp.name, projectName: projMap.get(a.projectId) ?? "" });
        }
      }

      const open = await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.status, "aberto"))).orderBy(asc(schema.timesheets.checkInAt));
      const autoClosedToday = (await db.select().from(schema.timesheets).where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.workDate, td), eq(schema.timesheets.autoClosed, 1)))).length;

      return {
        noShowCutoff: settings.noShowCutoff, autoCloseTime: settings.autoCloseTime,
        outOfZone, noShows,
        openNow: open.map((s) => ({ sheetId: s.id, employeeName: empMap.get(s.employeeId) ?? "", projectName: projMap.get(s.projectId) ?? "", since: s.checkInAt.toISOString() })),
        autoClosedToday,
      };
    },
  }),

  /* ================= EXPENSES ================= */
  listExpenses: defineAction({
    request: z.object({ companyId, projectId: z.number().optional() }),
    response: z.object({ expenses: z.array(z.object({ id: z.number(), projectId: z.number(), projectName: z.string(), item: z.string(), quantity: z.number(), unitCost: z.number(), total: z.number(), supplier: z.string(), expenseDate: z.string(), receiptNote: z.string(), billedInvoiceId: z.number().nullable(), billedInvoiceNumber: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      let rows = await db.select().from(schema.expenses).where(eq(schema.expenses.companyId, args.companyId)).orderBy(desc(schema.expenses.id)).limit(200);
      if (args.projectId !== undefined) rows = rows.filter((r) => r.projectId === args.projectId);
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const pm = new Map(projs.map((p) => [p.id, p.name]));
      const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      const invNum = new Map(invs.map((i) => [i.id, i.number]));
      return { expenses: rows.map((e) => ({ id: e.id, projectId: e.projectId, projectName: pm.get(e.projectId) ?? "", item: e.item, quantity: e.quantity, unitCost: e.unitCost, total: Math.round(e.quantity * e.unitCost), supplier: e.supplier, expenseDate: e.expenseDate, receiptNote: e.receiptNote, billedInvoiceId: e.billedInvoiceId, billedInvoiceNumber: e.billedInvoiceId ? (invNum.get(e.billedInvoiceId) ?? "") : "" })) };
    },
  }),

  createExpense: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), projectId: z.number(), item: z.string().min(1), quantity: z.number().default(1), unitCost: money, supplier: z.string().default(""), expenseDate: z.string(), receiptNote: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const projOk = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
      if (projOk.length === 0) throw new Error("Project not found in this company");
      const r = await db.insert(schema.expenses).values({ companyId: args.companyId, projectId: args.projectId, item: args.item, quantity: args.quantity, unitCost: args.unitCost, supplier: args.supplier, expenseDate: args.expenseDate, receiptNote: args.receiptNote }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  /* ================= INVOICES ================= */
  listInvoices: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), clientId: z.number().optional() }),
    response: z.object({ invoices: z.array(z.object({ id: z.number(), number: z.string(), clientId: z.number().nullable(), clientName: z.string(), projectId: z.number().nullable(), projectName: z.string(), issueDate: z.string(), dueDate: z.string(), terms: z.string(), status: z.string(), total: z.number(), paid: z.number(), balance: z.number() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      if (args.actorId !== undefined) { const a = await getActor(db, args.companyId, args.actorId); if (!a || a.role !== "admin") throw new Error("Only the company owner can view invoices."); }
      let rows = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId)).orderBy(desc(schema.invoices.id));
      if (args.clientId !== undefined) rows = rows.filter((r) => r.clientId === args.clientId);
      const cls = await db.select().from(schema.clients).where(eq(schema.clients.companyId, args.companyId));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const cm = new Map(cls.map((c) => [c.id, c.name]));
      const pm = new Map(projs.map((p) => [p.id, p.name]));
      const out = [];
      for (const inv of rows) {
        const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
        const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
        const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
        const paid = pays.reduce((s, p) => s + p.amount, 0);
        // derive status
        let st = inv.status;
        if (total > 0 && paid >= total) st = "paga";
        else if (paid > 0) st = "parcial";
        else st = "aberta";
        out.push({ id: inv.id, number: inv.number, clientId: inv.clientId, clientName: inv.clientId ? (cm.get(inv.clientId) ?? "") : "", projectId: inv.projectId, projectName: inv.projectId ? (pm.get(inv.projectId) ?? "") : "", issueDate: inv.issueDate, dueDate: inv.dueDate, terms: inv.terms ?? "NET 30", status: st, total, paid, balance: total - paid });
      }
      return { invoices: out };
    },
  }),

  getInvoiceDetail: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), invoiceId: z.number() }),
    response: z.object({
      invoice: z.object({ id: z.number(), number: z.string(), clientId: z.number().nullable(), clientName: z.string(), projectId: z.number().nullable(), projectName: z.string(), projectAddress: z.string(), issueDate: z.string(), dueDate: z.string(), terms: z.string(), status: z.string() }).nullable(),
      from: companyProfileOut.nullable(),
      billTo: z.object({ name: z.string(), contactName: z.string(), phone: z.string(), email: z.string(), email2: z.string(), address: z.string() }).nullable(),
      items: z.array(z.object({ id: z.number(), description: z.string(), quantity: z.number(), unitPrice: z.number(), total: z.number(), expenseId: z.number().nullable() })),
      payments: z.array(z.object({ id: z.number(), amount: z.number(), payDate: z.string(), method: z.string(), notes: z.string() })),
      total: z.number(), paid: z.number(), balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      if (args.actorId !== undefined) { const a = await getActor(db, args.companyId, args.actorId); if (!a || a.role !== "admin") throw new Error("Only the company owner can view invoice details."); }
      const rows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId))).limit(1);
      const inv = rows[0];
      if (!inv) return { invoice: null, from: null, billTo: null, items: [], payments: [], total: 0, paid: 0, balance: 0 };
      const compRows = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      const from = compRows[0] ? toCompanyProfile(compRows[0]) : null;
      const cls = inv.clientId ? await db.select().from(schema.clients).where(eq(schema.clients.id, inv.clientId)).limit(1) : [];
      const projs = inv.projectId ? await db.select().from(schema.projects).where(eq(schema.projects.id, inv.projectId)).limit(1) : [];
      const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
      const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id)).orderBy(desc(schema.invoicePayments.id));
      const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
      const paid = pays.reduce((s, p) => s + p.amount, 0);
      let st = inv.status;
      if (total > 0 && paid >= total) st = "paga"; else if (paid > 0) st = "parcial"; else st = "aberta";
      const client = cls[0];
      const proj = projs[0];
      const projectAddress = proj ? (formatAddress({ streetNumber: proj.streetNumber, streetName: proj.streetName, city: proj.city, state: proj.state, zip: proj.zip }) || proj.address) : "";
      const billTo = client ? { name: client.name, contactName: client.contactName, phone: client.phone, email: client.email, email2: client.email2 ?? "", address: formatAddress({ streetNumber: client.streetNumber, streetName: client.streetName, city: client.city, state: client.state, zip: client.zip }) || client.address } : null;
      return {
        invoice: { id: inv.id, number: inv.number, clientId: inv.clientId, clientName: cls[0]?.name ?? "", projectId: inv.projectId, projectName: projs[0]?.name ?? "", projectAddress, issueDate: inv.issueDate, dueDate: inv.dueDate, terms: inv.terms ?? "NET 30", status: st },
        from,
        billTo,
        items: items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: Math.round(i.quantity * i.unitPrice), expenseId: i.expenseId })),
        payments: pays.map((p) => ({ id: p.id, amount: p.amount, payDate: p.payDate, method: p.method, notes: p.notes ?? "" })),
        total, paid, balance: total - paid,
      };
    },
  }),

  createInvoice: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), clientId: z.number().nullable().default(null), projectId: z.number().nullable().default(null), number: z.string().min(1), issueDate: z.string(), dueDate: z.string(), terms: z.string().default("NET 30") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      if (args.clientId !== null && args.clientId !== undefined) {
        const cl = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
        if (cl.length === 0) throw new Error("Client not found in this company");
      }
      if (args.projectId !== null && args.projectId !== undefined) {
        const pj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
        if (pj.length === 0) throw new Error("Project not found in this company");
      }
      const r = await db.insert(schema.invoices).values({ companyId: args.companyId, clientId: args.clientId, projectId: args.projectId, number: args.number, issueDate: args.issueDate, dueDate: args.dueDate, terms: args.terms, status: "aberta" }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateInvoice: defineAction({
    request: z.object({ companyId, invoiceId: z.number(), actorId: z.number(), number: z.string().min(1).optional(), clientId: z.number().nullable().optional(), projectId: z.number().nullable().optional(), issueDate: z.string().optional(), dueDate: z.string().optional(), terms: z.string().optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const invRows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId))).limit(1);
      if (!invRows[0]) throw new Error("Invoice not found");
      if (args.clientId !== undefined && args.clientId !== null) {
        const cl = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
        if (cl.length === 0) throw new Error("Client not found in this company");
      }
      if (args.projectId !== undefined && args.projectId !== null) {
        const pj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
        if (pj.length === 0) throw new Error("Project not found in this company");
      }
      const patch: Record<string, unknown> = {};
      if (args.number !== undefined) patch.number = args.number;
      if (args.clientId !== undefined) patch.clientId = args.clientId;
      if (args.projectId !== undefined) patch.projectId = args.projectId;
      if (args.issueDate !== undefined) patch.issueDate = args.issueDate;
      if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
      if (args.terms !== undefined) patch.terms = args.terms;
      if (Object.keys(patch).length > 0) await db.update(schema.invoices).set(patch).where(eq(schema.invoices.id, args.invoiceId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addInvoiceItem: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), invoiceId: z.number(), description: z.string().min(1), quantity: z.number().default(1), unitPrice: money, expenseId: z.number().nullable().optional() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      // verify invoice belongs to company
      const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId))).limit(1);
      if (inv.length === 0) throw new Error("Invoice not found");
      const r = await db.insert(schema.invoiceItems).values({ invoiceId: args.invoiceId, description: args.description, quantity: args.quantity, unitPrice: args.unitPrice, expenseId: args.expenseId ?? null }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  addInvoicePayment: defineAction({
    request: z.object({ companyId, invoiceId: z.number(), actorId: z.number().optional(), amount: money, payDate: z.string(), method: z.string().default("Check"), notes: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      if (args.actorId !== undefined) await requireManager(db, args.companyId, args.actorId);
      const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId))).limit(1);
      if (inv.length === 0) throw new Error("Invoice not found");
      const r = await db.insert(schema.invoicePayments).values({ invoiceId: args.invoiceId, amount: args.amount, payDate: args.payDate, method: args.method, notes: args.notes }).$returningId();
      const newBalance = await (async () => {
        const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv[0]!.id));
        const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv[0]!.id));
        return items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0) - pays.reduce((s, p) => s + p.amount, 0);
      })();
      await notifyManagers(db, args.companyId, {
        type: "invoice_payment", title: `💵 Payment recorded on invoice #${inv[0]!.number}`,
        detail: `$${(args.amount / 100).toFixed(2)} via ${args.method} • Balance due now $${(Math.max(0, newBalance) / 100).toFixed(2)}.`,
        payload: { number: inv[0]!.number, amount: (args.amount / 100).toFixed(2), method: args.method, balance: (Math.max(0, newBalance) / 100).toFixed(2) },
        linkView: "invoices", linkId: inv[0]!.id, dedupeKey: `pay:${r[0]!.id}`,
      });
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  /* ================= PLATFORM OWNER (super-admin) ================= */
  ownerLogin: defineAction({
    request: z.object({ email: z.string().min(3) }),
    response: z.object({ email: z.string(), name: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const owner = await requireOwner(db, args.email);
      return { email: owner.email, name: owner.name };
    },
  }),

  listTenants: defineAction({
    request: z.object({ ownerEmail: z.string() }),
    response: z.object({
      tenants: z.array(z.object({
        id: z.string(), name: z.string(), code: z.string(), status: z.string(), plan: z.string(),
        createdAt: z.string(),
        counts: z.object({ users: z.number(), projects: z.number(), jobs: z.number(), timesheets: z.number(), invoices: z.number() }),
        totalRows: z.number(), storageBytes: z.number(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comps = await db.select().from(schema.companies).orderBy(asc(schema.companies.id));
      const tenants = [];
      for (const c of comps) {
        const data = await collectTenantData(db, c.id);
        const count = (t: string) => data[t]?.length ?? 0;
        const totalRows = Object.entries(data).reduce((s, [t, rows]) => s + (t === "companies" ? 0 : rows.length), 0);
        tenants.push({
          id: c.id, name: c.name, code: c.code, status: c.status, plan: c.plan,
          createdAt: c.createdAt > 0 ? new Date(c.createdAt).toISOString() : "",
          counts: { users: count("employees"), projects: count("projects"), jobs: count("jobs"), timesheets: count("timesheets"), invoices: count("invoices") },
          totalRows,
          storageBytes: new TextEncoder().encode(JSON.stringify(data)).length,
        });
      }
      return { tenants };
    },
  }),

  createTenant: defineAction({
    request: z.object({ ownerEmail: z.string(), companyName: z.string().min(1), adminName: z.string().min(1), adminEmail: z.string().min(3) }),
    response: z.object({ companyId: z.string(), code: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comps = await db.select().from(schema.companies);
      let maxN = 0;
      for (const c of comps) {
        const m = c.id.match(/^BUILDER(\d+)$/);
        if (m) maxN = Math.max(maxN, Number(m[1]));
      }
      const newId = `BUILDER${String(maxN + 1).padStart(3, "0")}`;
      await db.insert(schema.companies).values({ id: newId, name: args.companyName, code: newId, status: "trial", plan: "Pilot", createdAt: Date.now() });
      await db.insert(schema.employees).values({ companyId: newId, name: args.adminName, role: "admin", trade: "Admin", phone: "", email: args.adminEmail, payType: "contrato", payRate: 0, status: "ativo" });
      ctx.invalidateQueries();
      return { companyId: newId, code: newId };
    },
  }),

  setTenantStatus: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string(), status: z.enum(["trial", "active", "suspended"]) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      if (!comp[0]) throw new Error("Tenant not found");
      await db.update(schema.companies).set({ status: args.status }).where(eq(schema.companies.id, args.companyId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setTenantPlan: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string(), plan: z.string().min(1).max(60) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      if (!comp[0]) throw new Error("Tenant not found");
      await db.update(schema.companies).set({ plan: args.plan }).where(eq(schema.companies.id, args.companyId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Full tenant dataset export: JSON + MySQL-compatible SQL. This is the
     database-per-tenant migration path: create one MySQL database per
     tenant, run the production schema, import the SQL dump. */
  exportTenant: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string() }),
    response: z.object({ companyId: z.string(), companyName: z.string(), json: z.string(), sql: z.string(), totalRows: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      const c = comp[0];
      if (!c) throw new Error("Tenant not found");
      const data = await collectTenantData(db, args.companyId);
      const totalRows = Object.entries(data).reduce((s, [t, rows]) => s + (t === "companies" ? 0 : rows.length), 0);
      const json = JSON.stringify({ tenant: { id: c.id, name: c.name, code: c.code, status: c.status, plan: c.plan, exportedAt: new Date().toISOString() }, tables: data }, null, 2);
      return { companyId: c.id, companyName: c.name, json, sql: buildTenantSql(c.name, c.code, data), totalRows };
    },
  }),

  /* Deleting a tenant is irreversible. The owner must download the export
     first (exportConfirmed); the client additionally asks twice. */
  deleteTenant: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string(), exportConfirmed: z.boolean() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      if (!args.exportConfirmed) throw new Error("Download this tenant's database export before deleting. Deleting without an export is not allowed.");
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      if (!comp[0]) throw new Error("Tenant not found");
      const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      for (const inv of invs) {
        await db.delete(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
        await db.delete(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
      }
      await db.delete(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      await db.delete(schema.timesheetAdjustments).where(eq(schema.timesheetAdjustments.companyId, args.companyId));
      await db.delete(schema.locationPings).where(eq(schema.locationPings.companyId, args.companyId));
      await db.delete(schema.timesheets).where(eq(schema.timesheets.companyId, args.companyId));
      await db.delete(schema.assignments).where(eq(schema.assignments.companyId, args.companyId));
      await db.delete(schema.jobTasks).where(eq(schema.jobTasks.companyId, args.companyId));
      await db.delete(schema.taskPhotos).where(eq(schema.taskPhotos.companyId, args.companyId));
      await db.delete(schema.jobs).where(eq(schema.jobs.companyId, args.companyId));
      await db.delete(schema.progressUpdates).where(eq(schema.progressUpdates.companyId, args.companyId));
      await db.delete(schema.expenses).where(eq(schema.expenses.companyId, args.companyId));
      await db.delete(schema.notifications).where(eq(schema.notifications.companyId, args.companyId));
      await db.delete(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, args.companyId));
      await db.delete(schema.taskTimeLogs).where(eq(schema.taskTimeLogs.companyId, args.companyId));
      await db.delete(schema.projectServices).where(eq(schema.projectServices.companyId, args.companyId));
      await db.delete(schema.projectPlans).where(eq(schema.projectPlans.companyId, args.companyId));
      await db.delete(schema.services).where(eq(schema.services.companyId, args.companyId));
      await db.delete(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      await db.delete(schema.clients).where(eq(schema.clients.companyId, args.companyId));
      await db.delete(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      await db.delete(schema.companySettings).where(eq(schema.companySettings.companyId, args.companyId));
      await db.delete(schema.companies).where(eq(schema.companies.id, args.companyId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* Tenant-isolation self-test: verifies referential tenant consistency and
     that tenant-scoped reads cannot see another tenant's rows. */
  runIsolationCheck: defineAction({
    request: z.object({ ownerEmail: z.string() }),
    response: z.object({
      ok: z.boolean(), ranAt: z.string(), tenantCount: z.number(),
      checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireOwner(db, args.ownerEmail);
      const comps = await db.select().from(schema.companies);
      const compIds = new Set(comps.map((c) => c.id));
      const checks: { name: string; ok: boolean; detail: string }[] = [];
      const push = (name: string, bad: number, okDetail: string) =>
        checks.push({ name, ok: bad === 0, detail: bad === 0 ? okDetail : `${bad} violating row(s) found` });

      // 1) No orphan rows: every company-keyed row points at a real tenant.
      const keyed: [string, Array<{ companyId: string }>][] = [
        ["employees", await db.select().from(schema.employees)],
        ["clients", await db.select().from(schema.clients)],
        ["projects", await db.select().from(schema.projects)],
        ["jobs", await db.select().from(schema.jobs)],
        ["job_tasks", await db.select().from(schema.jobTasks)],
        ["task_photos", await db.select().from(schema.taskPhotos)],
        ["assignments", await db.select().from(schema.assignments)],
        ["timesheets", await db.select().from(schema.timesheets)],
        ["invoices", await db.select().from(schema.invoices)],
        ["expenses", await db.select().from(schema.expenses)],
        ["progress_updates", await db.select().from(schema.progressUpdates)],
        ["services", await db.select().from(schema.services)],
        ["project_services", await db.select().from(schema.projectServices)],
        ["project_plans", await db.select().from(schema.projectPlans)],
      ];
      let orphans = 0;
      for (const [, rows] of keyed) orphans += rows.filter((r) => !compIds.has(r.companyId)).length;
      push("No orphan rows (every row belongs to a real tenant)", orphans, "All tenant-keyed rows resolve to an existing company.");

      const projects = await db.select().from(schema.projects);
      const projById = new Map(projects.map((p) => [p.id, p]));
      const clients = await db.select().from(schema.clients);
      const clientById = new Map(clients.map((c) => [c.id, c]));
      const employees = await db.select().from(schema.employees);
      const empById = new Map(employees.map((e) => [e.id, e]));
      const jobs = await db.select().from(schema.jobs);
      const jobById = new Map(jobs.map((j) => [j.id, j]));

      // 2) Projects only reference clients of the same tenant.
      push("Projects reference only their own tenant's clients",
        projects.filter((p) => p.clientId !== null && clientById.get(p.clientId)?.companyId !== p.companyId).length,
        "Every project→client link stays inside one tenant.");

      // 3) Jobs belong to projects of the same tenant.
      push("Jobs belong to projects of the same tenant",
        jobs.filter((j) => projById.get(j.projectId)?.companyId !== j.companyId).length,
        "Every job→project link stays inside one tenant.");

      // 4) Assignments: project (and job, when set) in the same tenant.
      const assigns = await db.select().from(schema.assignments);
      push("Crew assignments stay inside one tenant",
        assigns.filter((a) => projById.get(a.projectId)?.companyId !== a.companyId || (a.jobId !== null && (jobById.get(a.jobId)?.companyId !== a.companyId || jobById.get(a.jobId)?.projectId !== a.projectId))).length,
        "Every assignment's project/job matches the row's tenant.");

      // 5) Timesheets: project, employee (and job, when set) in the same tenant.
      const sheets = await db.select().from(schema.timesheets);
      push("Timesheets stay inside one tenant",
        sheets.filter((s) => projById.get(s.projectId)?.companyId !== s.companyId || empById.get(s.employeeId)?.companyId !== s.companyId || (s.jobId !== null && jobById.get(s.jobId)?.companyId !== s.companyId)).length,
        "Every timesheet's project/employee/job matches the row's tenant.");

      // 6) Invoices reference only their own tenant's clients/projects.
      const invs = await db.select().from(schema.invoices);
      push("Invoices reference only their own tenant's clients/projects",
        invs.filter((i) => (i.clientId !== null && clientById.get(i.clientId)?.companyId !== i.companyId) || (i.projectId !== null && projById.get(i.projectId)?.companyId !== i.companyId)).length,
        "Every invoice link stays inside one tenant.");

      // 7) Cross-tenant read probe: a tenant-scoped lookup for another
      // tenant's project must return nothing, for every tenant pair.
      let leaks = 0;
      for (const a of comps) {
        const foreign = projects.find((p) => p.companyId !== a.id);
        if (!foreign) continue;
        const seen = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, a.id), eq(schema.projects.id, foreign.id)));
        if (seen.length > 0) leaks += 1;
      }
      push("Cross-tenant read probe (scoped queries see only own rows)", leaks,
        comps.length > 1 ? "For every tenant pair, the other tenant's projects are invisible to scoped reads." : "Only one tenant exists; probe ran trivially.");

      return { ok: checks.every((c) => c.ok), ranAt: new Date().toISOString(), tenantCount: comps.length, checks };
    },
  }),

  /* ================= PAYROLL + DASHBOARD ================= */
  getPayroll: defineAction({
    request: z.object({ companyId, actorId: z.number().optional(), weekOnly: z.boolean().default(true), periodStart: z.string().optional(), periodEnd: z.string().optional() }),
    response: z.object({
      rows: z.array(z.object({
        employeeId: z.number(), employeeName: z.string(), trade: z.string(), payType: z.string(), payRate: z.number(),
        hours: z.number(), regularHours: z.number(), otHours: z.number(), days: z.number(), amount: z.number(),
        paid: z.boolean(), payoutId: z.number().nullable(),
        paidAmount: z.number().nullable(), balance: z.number().nullable(),
        outstandingAdvances: z.number(),
      })),
      total: z.number(),
      periodStart: z.string(), periodEnd: z.string(),
      otEnabled: z.boolean(), otDailyHours: z.number(), otWeeklyHours: z.number(), otMultiplier: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      if (args.actorId !== undefined) { const a = await getActor(db, args.companyId, args.actorId); if (!a || a.role !== "admin") throw new Error("Only the company owner can view payroll."); }
      await applyAutoClose(db, args.companyId);
      const settings = await getSettings(db, args.companyId);
      let from: string | null = null; let to: string | null = null;
      if (args.periodStart && args.periodEnd) { from = args.periodStart; to = args.periodEnd; }
      else if (args.weekOnly) { const wb = weekBounds(); from = wb.start; to = wb.end; }
      const rows = await computePayrollRows(db, args.companyId, from, to);
      const payouts = await db.select().from(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, args.companyId));
      const advances = await db.select().from(schema.payrollAdvances)
        .where(and(eq(schema.payrollAdvances.companyId, args.companyId), eq(schema.payrollAdvances.deducted, 0)));
      const out = rows.map((r) => {
        const p = from !== null && to !== null
          ? payouts.find((x) => x.employeeId === r.employeeId && x.periodStart === from && x.periodEnd === to && x.payType === r.payType && x.payRate === r.payRate)
          : undefined;
        const empAdvances = advances.filter((a) => a.employeeId === r.employeeId).reduce((s, a) => s + a.amount, 0);
        return {
          ...r, paid: !!p, payoutId: p?.id ?? null,
          paidAmount: p ? (p.paidAmount ?? p.gross) : null,
          balance: p ? (p.gross - (p.paidAmount ?? p.gross)) : null,
          outstandingAdvances: empAdvances,
        };
      });
      return {
        rows: out, total: out.reduce((s, r) => s + r.amount, 0),
        periodStart: from ?? "", periodEnd: to ?? "",
        otEnabled: settings.otEnabled, otDailyHours: settings.otDailyHours, otWeeklyHours: settings.otWeeklyHours, otMultiplier: settings.otMultiplier,
      };
    },
  }),

  /* Marks employees as paid for one Mon–Sun period. Amounts are recomputed
     on the server from approved timesheets — the client's numbers are never
     trusted. An existing payout for the same employee+period is refused:
     paid periods are locked and never recalculated. Admin only. */
  markPayrollPaid: defineAction({
    request: z.object({
      companyId, actorId: z.number(), employeeIds: z.array(z.number()).min(1),
      periodStart: z.string(), periodEnd: z.string(), paidDate: z.string(),
      method: z.enum(["Check", "Direct deposit", "Cash", "Other"]),
      reference: z.string().default(""), notes: z.string().default(""),
      paidAmounts: z.record(z.string(), z.number().int().min(0)).optional(), // employeeId -> cents actually paid (default: gross)
    }),
    response: z.object({ ok: z.literal(true), count: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; count: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      if (!actor[0] || actor[0].role !== "admin") throw new Error("Only an admin can mark payroll as paid.");
      const settings = await getSettings(db, args.companyId);
      const rows = (await computePayrollRows(db, args.companyId, args.periodStart, args.periodEnd))
        .filter((r) => args.employeeIds.includes(r.employeeId));
      if (rows.length === 0) throw new Error("No approved hours found for the selected people in this period.");
      const existing = await db.select().from(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, args.companyId));
      let count = 0;
      for (const r of rows) {
        const dup = existing.find((p) => p.employeeId === r.employeeId && p.periodStart === args.periodStart && p.periodEnd === args.periodEnd && p.payType === r.payType && p.payRate === r.payRate);
        if (dup) continue; // already paid & locked — skip silently, never double-pay
        await db.insert(schema.payrollPayouts).values({
          companyId: args.companyId, employeeId: r.employeeId,
          periodStart: args.periodStart, periodEnd: args.periodEnd,
          hours: r.hours, regularHours: r.regularHours, otHours: r.otHours,
          otMultiplier: r.payType === "hora" && settings.otEnabled ? settings.otMultiplier : 1,
          days: r.days, gross: r.amount, payType: r.payType, payRate: r.payRate,
          paidDate: args.paidDate, method: args.method, reference: args.reference, notes: args.notes,
          paidAmount: args.paidAmounts?.[String(r.employeeId)] ?? r.amount,
          createdBy: args.actorId, createdAt: new Date(),
        });
        count += 1;
      }
      if (count === 0) throw new Error("Everyone selected is already paid for this period (paid periods are locked).");
      ctx.invalidateQueries();
      return { ok: true as const, count };
    },
  }),

  recordPayrollAdvance: defineAction({
    request: z.object({
      companyId, actorId: z.number(), employeeId: z.number(),
      amountCents: z.number().int().min(1), advanceDate: z.string(), notes: z.string().max(255).default(""),
    }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      if (!actor[0] || actor[0].role !== "admin") throw new Error("Only an admin can record advances.");
      const r = await db.insert(schema.payrollAdvances).values({
        companyId: args.companyId, employeeId: args.employeeId,
        amount: args.amountCents, advanceDate: args.advanceDate, notes: args.notes,
        deducted: 0, createdBy: args.actorId, createdAt: new Date(),
      }).$returningId();
      ctx.invalidateQueries();
      return { ok: true as const, id: r[0]!.id };
    },
  }),

  listPayrollAdvances: defineAction({
    request: z.object({ companyId, actorId: z.number() }),
    response: z.object({
      advances: z.array(z.object({
        id: z.number(), employeeId: z.number(), employeeName: z.string(),
        amountCents: z.number(), advanceDate: z.string(), notes: z.string(),
        deducted: z.boolean(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireManager(db, args.companyId, args.actorId);
      const rows = await db.select().from(schema.payrollAdvances)
        .where(eq(schema.payrollAdvances.companyId, args.companyId))
        .orderBy(desc(schema.payrollAdvances.advanceDate));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const empById = new Map(emps.map((e) => [e.id, e.name]));
      return {
        advances: rows.map((r) => ({
          id: r.id, employeeId: r.employeeId, employeeName: empById.get(r.employeeId) ?? "?",
          amountCents: r.amount, advanceDate: r.advanceDate, notes: r.notes ?? "",
          deducted: r.deducted === 1,
        })),
      };
    },
  }),

  listPayrollPayouts: defineAction({
    request: z.object({ companyId }),
    response: z.object({
      payouts: z.array(z.object({
        id: z.number(), employeeId: z.number(), employeeName: z.string(),
        periodStart: z.string(), periodEnd: z.string(), hours: z.number(), regularHours: z.number(), otHours: z.number(),
        days: z.number(), gross: z.number(), payType: z.string(), payRate: z.number(),
        paidDate: z.string(), method: z.string(), reference: z.string(), notes: z.string(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.payrollPayouts).where(eq(schema.payrollPayouts.companyId, args.companyId)).orderBy(desc(schema.payrollPayouts.id));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const em = new Map(emps.map((e) => [e.id, e.name]));
      return {
        payouts: rows.map((p) => ({
          id: p.id, employeeId: p.employeeId, employeeName: em.get(p.employeeId) ?? "",
          periodStart: p.periodStart, periodEnd: p.periodEnd, hours: p.hours, regularHours: p.regularHours, otHours: p.otHours,
          days: p.days, gross: p.gross, payType: p.payType, payRate: p.payRate,
          paidDate: p.paidDate, method: p.method, reference: p.reference, notes: p.notes,
        })),
      };
    },
  }),

  /* One printable pay stub: everything on it comes from the locked payout
     row, so what was paid is exactly what the stub shows, forever. */
  getPayStub: defineAction({
    request: z.object({ companyId, payoutId: z.number() }),
    response: z.object({
      stub: z.object({
        id: z.number(), companyName: z.string(),
        employeeName: z.string(), trade: z.string(),
        periodStart: z.string(), periodEnd: z.string(),
        payType: z.string(), payRate: z.number(),
        hours: z.number(), regularHours: z.number(), otHours: z.number(), otMultiplier: z.number(), days: z.number(),
        regularPay: z.number(), otPay: z.number(), gross: z.number(),
        paidDate: z.string(), method: z.string(), reference: z.string(), notes: z.string(),
      }).nullable(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.payrollPayouts).where(and(eq(schema.payrollPayouts.companyId, args.companyId), eq(schema.payrollPayouts.id, args.payoutId))).limit(1);
      const p = rows[0];
      if (!p) return { stub: null };
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      const emp = await db.select().from(schema.employees).where(eq(schema.employees.id, p.employeeId)).limit(1);
      const regularPay = p.payType === "hora" ? Math.round(p.regularHours * p.payRate) : p.gross;
      const otPay = p.payType === "hora" ? p.gross - regularPay : 0;
      return {
        stub: {
          id: p.id, companyName: comp[0]?.name ?? "",
          employeeName: emp[0]?.name ?? "", trade: emp[0]?.trade ?? "",
          periodStart: p.periodStart, periodEnd: p.periodEnd,
          payType: p.payType, payRate: p.payRate,
          hours: p.hours, regularHours: p.regularHours, otHours: p.otHours, otMultiplier: p.otMultiplier, days: p.days,
          regularPay, otPay, gross: p.gross,
          paidDate: p.paidDate, method: p.method, reference: p.reference, notes: p.notes,
        },
      };
    },
  }),

  /* ================= NOTIFICATIONS (in-app) ================= */
  listNotifications: defineAction({
    request: z.object({ companyId, userId: z.number() }),
    response: z.object({
      notifications: z.array(z.object({
        id: z.number(), type: z.string(), title: z.string(), detail: z.string(), payload: z.string(),
        linkView: z.string(), linkId: z.number().nullable(), read: z.boolean(), createdAt: z.string(),
      })),
      unread: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await applyAutoClose(db, args.companyId);
      await scanNotifications(db, args.companyId);
      const rows = (await db.select().from(schema.notifications)
        .where(and(eq(schema.notifications.companyId, args.companyId), eq(schema.notifications.userId, args.userId)))
        .orderBy(desc(schema.notifications.id))).slice(0, 60);
      return {
        notifications: rows.map((n) => ({
          id: n.id, type: n.type, title: n.title, detail: n.detail, payload: n.payload,
          linkView: n.linkView, linkId: n.linkId, read: n.readAt !== null, createdAt: n.createdAt.toISOString(),
        })),
        unread: rows.filter((n) => n.readAt === null).length,
      };
    },
  }),

  markNotificationRead: defineAction({
    request: z.object({ companyId, userId: z.number(), id: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await db.update(schema.notifications).set({ readAt: new Date() })
        .where(and(eq(schema.notifications.companyId, args.companyId), eq(schema.notifications.userId, args.userId), eq(schema.notifications.id, args.id)));
      return { ok: true as const };
    },
  }),

  markAllNotificationsRead: defineAction({
    request: z.object({ companyId, userId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await db.update(schema.notifications).set({ readAt: new Date() })
        .where(and(eq(schema.notifications.companyId, args.companyId), eq(schema.notifications.userId, args.userId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= TASK WORK TIME (timer + manual log) ================= */
  /* Starting work requires an open (checked-in) timesheet on the task's
     project — the timer never runs for someone who is not on the clock. */
  startTaskTimer: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number() }),
    response: z.object({ ok: z.literal(true), logId: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; logId: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const task = await requireTask(db, args.companyId, args.taskId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      const isManagerActor = actor[0] && (actor[0].role === "admin" || actor[0].role === "gerente");
      if (!isManagerActor && !(await taskVisibleTo(db, args.companyId, args.actorId, task))) {
        throw new Error("This task is not assigned to you.");
      }
      const jobRow = await db.select().from(schema.jobs).where(eq(schema.jobs.id, task.jobId)).limit(1);
      const projectId = jobRow[0]?.projectId ?? 0;
      const openSheets = await db.select().from(schema.timesheets)
        .where(and(eq(schema.timesheets.companyId, args.companyId), eq(schema.timesheets.employeeId, args.actorId), eq(schema.timesheets.status, "aberto")));
      if (!openSheets.some((s) => s.projectId === projectId)) {
        throw new Error("Check in at this job site first — the work timer only runs while you are on the clock.");
      }
      if (task.status === "done") throw new Error("This task is already done.");
      const logs = await db.select().from(schema.taskTimeLogs)
        .where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId), eq(schema.taskTimeLogs.employeeId, args.actorId)));
      if (logs.some((l) => l.endedAt === null)) throw new Error("Your timer is already running on this task.");
      const now = new Date();
      const r = await db.insert(schema.taskTimeLogs).values({
        companyId: args.companyId, taskId: args.taskId, employeeId: args.actorId,
        kind: "timer", startedAt: now, endedAt: null, minutes: 0, createdAt: now,
      }).$returningId();
      if (task.status === "todo") {
        await db.update(schema.jobTasks).set({ status: "in_progress", startedAt: task.startedAt ?? now })
          .where(and(eq(schema.jobTasks.companyId, args.companyId), eq(schema.jobTasks.id, args.taskId)));
      }
      ctx.invalidateQueries();
      return { ok: true as const, logId: r[0]!.id };
    },
  }),

  pauseTaskTimer: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number() }),
    response: z.object({ ok: z.literal(true), totalMinutes: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; totalMinutes: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireTask(db, args.companyId, args.taskId);
      const logs = await db.select().from(schema.taskTimeLogs)
        .where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId), eq(schema.taskTimeLogs.employeeId, args.actorId)));
      const open = logs.find((l) => l.endedAt === null && l.startedAt !== null);
      if (!open) throw new Error("No timer is running for you on this task.");
      const now = new Date();
      const add = Math.max(0, Math.round(((now.getTime() - open.startedAt!.getTime()) / 60000) * 10) / 10);
      await db.update(schema.taskTimeLogs).set({ endedAt: now, minutes: open.minutes + add }).where(eq(schema.taskTimeLogs.id, open.id));
      const all = await db.select().from(schema.taskTimeLogs)
        .where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId)));
      ctx.invalidateQueries();
      return { ok: true as const, totalMinutes: Math.round(all.reduce((s, l) => s + l.minutes, 0) * 10) / 10 };
    },
  }),

  logTaskHours: defineAction({
    request: z.object({ companyId, actorId: z.number(), taskId: z.number(), hours: z.number().min(0.1).max(24), note: z.string().default("") }),
    response: z.object({ ok: z.literal(true), id: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; id: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      const task = await requireTask(db, args.companyId, args.taskId);
      const actor = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.actorId))).limit(1);
      const isManagerActor = actor[0] && (actor[0].role === "admin" || actor[0].role === "gerente");
      if (!isManagerActor && !(await taskVisibleTo(db, args.companyId, args.actorId, task))) {
        throw new Error("This task is not assigned to you.");
      }
      const r = await db.insert(schema.taskTimeLogs).values({
        companyId: args.companyId, taskId: args.taskId, employeeId: args.actorId,
        kind: "manual", startedAt: null, endedAt: null, minutes: Math.round(args.hours * 60 * 10) / 10, note: args.note, createdAt: new Date(),
      }).$returningId();
      ctx.invalidateQueries();
      return { ok: true as const, id: r[0]!.id };
    },
  }),

  /* Per-task time detail for the job detail: every segment, totals per
     person, and labor cost for hourly workers (hours-only for daily /
     contract pay, where the rate is not per-hour). */
  listTaskTime: defineAction({
    request: z.object({ companyId, taskId: z.number() }),
    response: z.object({
      totalMinutes: z.number(),
      logs: z.array(z.object({
        id: z.number(), employeeId: z.number(), employeeName: z.string(), kind: z.string(),
        startedAt: z.string().nullable(), endedAt: z.string().nullable(), minutes: z.number(),
        note: z.string(), createdAt: z.string(),
      })),
      byEmployee: z.array(z.object({
        employeeId: z.number(), employeeName: z.string(), payType: z.string(), minutes: z.number(), laborCost: z.number().nullable(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireTask(db, args.companyId, args.taskId);
      const rows = await db.select().from(schema.taskTimeLogs)
        .where(and(eq(schema.taskTimeLogs.companyId, args.companyId), eq(schema.taskTimeLogs.taskId, args.taskId)))
        .orderBy(desc(schema.taskTimeLogs.id));
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const empById = new Map(emps.map((e) => [e.id, e]));
      const nowMs = Date.now();
      const effective = rows.map((l) => {
        let mins = l.minutes;
        if (l.endedAt === null && l.startedAt !== null) mins += Math.max(0, (nowMs - l.startedAt.getTime()) / 60000);
        return { row: l, minutes: Math.round(mins * 10) / 10 };
      });
      const perEmp = new Map<number, number>();
      for (const e of effective) perEmp.set(e.row.employeeId, (perEmp.get(e.row.employeeId) ?? 0) + e.minutes);
      return {
        totalMinutes: Math.round(effective.reduce((s, e) => s + e.minutes, 0) * 10) / 10,
        logs: effective.map(({ row: l, minutes }) => ({
          id: l.id, employeeId: l.employeeId, employeeName: empById.get(l.employeeId)?.name ?? "",
          kind: l.kind, startedAt: l.startedAt?.toISOString() ?? null, endedAt: l.endedAt?.toISOString() ?? null,
          minutes, note: l.note, createdAt: l.createdAt.toISOString(),
        })),
        byEmployee: [...perEmp.entries()].map(([employeeId, minutes]) => {
          const emp = empById.get(employeeId);
          return {
            employeeId, employeeName: emp?.name ?? "", payType: emp?.payType ?? "hora",
            minutes: Math.round(minutes * 10) / 10,
            laborCost: emp && emp.payType === "hora" ? Math.round((minutes / 60) * emp.payRate) : null,
          };
        }),
      };
    },
  }),


  /* ================= FLEET / VEHICLES ================= */
  listVehicles: defineAction({
    request: z.object({ companyId, actorId: z.number() }),
    response: z.object({ vehicles: z.array(vehicleOut) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const actor = await getActor(db, args.companyId, args.actorId);
      if (!actor || (actor.role !== "admin" && actor.role !== "gerente" && actor.role !== "funcionario")) {
        throw new Error("Not allowed.");
      }
      await ensureFleetSeed(db);
      const rows = await db.select().from(schema.vehicles).where(eq(schema.vehicles.companyId, args.companyId)).orderBy(asc(schema.vehicles.name));
      const usersMap = await vehicleUsersMap(db, args.companyId);
      const tickets = await db.select().from(schema.vehicleTickets).where(eq(schema.vehicleTickets.companyId, args.companyId));
      const openByVehicle = new Map<number, number>();
      for (const t of tickets) if (t.status === "open") openByVehicle.set(t.vehicleId, (openByVehicle.get(t.vehicleId) ?? 0) + 1);
      const list = actor.role === "funcionario"
        ? rows.filter((v) => (usersMap.get(v.id)?.ids ?? []).includes(actor.id))
        : rows;
      return { vehicles: list.map((v) => toVehicleOut(v, usersMap.get(v.id) ?? { ids: [], names: [] }, openByVehicle.get(v.id) ?? 0)) };
    },
  }),

  getVehicleDetail: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number() }),
    response: z.object({
      vehicle: vehicleOut,
      assignments: z.array(z.object({ id: z.number(), employeeId: z.number(), employeeName: z.string(), assignedAt: z.string(), unassignedAt: z.string().nullable(), current: z.boolean() })),
      mileageLogs: z.array(z.object({ id: z.number(), logDate: z.string(), odometer: z.number(), notes: z.string() })),
      fuelLogs: z.array(z.object({ id: z.number(), logDate: z.string(), gallons: z.number(), amount: z.number(), odometer: z.number(), projectId: z.number().nullable(), projectName: z.string(), notes: z.string(), receiptPhoto: z.string(), mpg: z.number().nullable() })),
      maintenance: z.array(z.object({ id: z.number(), maintDate: z.string(), type: z.string(), cost: z.number(), vendor: z.string(), odometer: z.number(), notes: z.string(), receiptNote: z.string(), projectId: z.number().nullable(), projectName: z.string() })),
      tickets: z.array(z.object({ id: z.number(), ticketDate: z.string(), description: z.string(), amount: z.number(), status: z.string(), employeeId: z.number().nullable(), employeeName: z.string(), notes: z.string() })),
      totals: z.object({ fuelCost: z.number(), maintenanceCost: z.number(), ticketsCost: z.number(), openTicketsAmount: z.number() }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireVehicleUser(db, args.companyId, args.actorId, args.vehicleId);
      const v = await requireVehicle(db, args.companyId, args.vehicleId);
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const empById = new Map(emps.map((e) => [e.id, e]));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const projById = new Map(projs.map((pr) => [pr.id, pr]));
      const usersMap = await vehicleUsersMap(db, args.companyId);
      const ticketsAll = await db.select().from(schema.vehicleTickets).where(eq(schema.vehicleTickets.companyId, args.companyId));
      const openCount = ticketsAll.filter((t) => t.vehicleId === v.id && t.status === "open").length;

      const assignRows = (await db.select().from(schema.vehicleAssignments)
        .where(and(eq(schema.vehicleAssignments.companyId, args.companyId), eq(schema.vehicleAssignments.vehicleId, v.id)))
        .orderBy(desc(schema.vehicleAssignments.id)));
      const mileageRows = (await db.select().from(schema.vehicleMileageLogs)
        .where(and(eq(schema.vehicleMileageLogs.companyId, args.companyId), eq(schema.vehicleMileageLogs.vehicleId, v.id)))
        .orderBy(desc(schema.vehicleMileageLogs.logDate), desc(schema.vehicleMileageLogs.id)));
      const fuelRowsAsc = (await db.select().from(schema.vehicleFuelLogs)
        .where(and(eq(schema.vehicleFuelLogs.companyId, args.companyId), eq(schema.vehicleFuelLogs.vehicleId, v.id)))
        .orderBy(asc(schema.vehicleFuelLogs.odometer), asc(schema.vehicleFuelLogs.id)));
      const mpgById = new Map<number, number | null>();
      for (let i = 0; i < fuelRowsAsc.length; i++) {
        const cur = fuelRowsAsc[i]!;
        if (i === 0) { mpgById.set(cur.id, null); continue; }
        const prev = fuelRowsAsc[i - 1]!;
        const miles = cur.odometer - prev.odometer;
        mpgById.set(cur.id, cur.gallons > 0 && miles > 0 ? Math.round((miles / cur.gallons) * 10) / 10 : null);
      }
      const fuelRows = [...fuelRowsAsc].reverse();
      const maintRows = (await db.select().from(schema.vehicleMaintenance)
        .where(and(eq(schema.vehicleMaintenance.companyId, args.companyId), eq(schema.vehicleMaintenance.vehicleId, v.id)))
        .orderBy(desc(schema.vehicleMaintenance.maintDate), desc(schema.vehicleMaintenance.id)));
      const ticketRows = (await db.select().from(schema.vehicleTickets)
        .where(and(eq(schema.vehicleTickets.companyId, args.companyId), eq(schema.vehicleTickets.vehicleId, v.id)))
        .orderBy(desc(schema.vehicleTickets.ticketDate), desc(schema.vehicleTickets.id)));

      return {
        vehicle: toVehicleOut(v, usersMap.get(v.id) ?? { ids: [], names: [] }, openCount),
        assignments: assignRows.map((a) => ({
          id: a.id, employeeId: a.employeeId, employeeName: empById.get(a.employeeId)?.name ?? "",
          assignedAt: a.assignedAt.toISOString(), unassignedAt: a.unassignedAt?.toISOString() ?? null,
          current: a.unassignedAt === null,
        })),
        mileageLogs: mileageRows.map((m) => ({ id: m.id, logDate: m.logDate, odometer: m.odometer, notes: m.notes })),
        fuelLogs: fuelRows.map((f) => ({
          id: f.id, logDate: f.logDate, gallons: f.gallons, amount: f.amount, odometer: f.odometer,
          projectId: f.projectId ?? null, projectName: f.projectId ? (projById.get(f.projectId)?.name ?? "") : "",
          notes: f.notes, receiptPhoto: f.receiptPhoto ?? "", mpg: mpgById.get(f.id) ?? null,
        })),
        maintenance: maintRows.map((m) => ({
          id: m.id, maintDate: m.maintDate, type: m.type, cost: m.cost, vendor: m.vendor, odometer: m.odometer,
          notes: m.notes, receiptNote: m.receiptNote,
          projectId: m.projectId ?? null, projectName: m.projectId ? (projById.get(m.projectId)?.name ?? "") : "",
        })),
        tickets: ticketRows.map((t) => ({
          id: t.id, ticketDate: t.ticketDate, description: t.description, amount: t.amount, status: t.status,
          employeeId: t.employeeId ?? null, employeeName: t.employeeId ? (empById.get(t.employeeId)?.name ?? "") : "",
          notes: t.notes,
        })),
        totals: {
          fuelCost: fuelRows.reduce((sum, f) => sum + f.amount, 0),
          maintenanceCost: maintRows.reduce((sum, m) => sum + m.cost, 0),
          ticketsCost: ticketRows.reduce((sum, t) => sum + t.amount, 0),
          openTicketsAmount: ticketRows.filter((t) => t.status === "open").reduce((sum, t) => sum + t.amount, 0),
        },
      };
    },
  }),

  createVehicle: defineAction({
    request: z.object({ companyId, actorId: z.number(), name: z.string().min(1), make: z.string().default(""), model: z.string().default(""), year: z.number().int().min(0).max(2100).default(0), plate: z.string().default(""), vin: z.string().default(""), photoUrl: z.string().default(""), status: z.enum(["active", "in_shop", "inactive"]).default("active"), mileage: z.number().int().min(0).default(0) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      if (args.photoUrl && !args.photoUrl.startsWith("data:image/")) throw new Error("Only photos captured on the device can be attached.");
      const r = await db.insert(schema.vehicles).values({
        companyId: args.companyId, name: args.name.trim(), make: args.make.trim(), model: args.model.trim(),
        year: args.year, plate: args.plate.trim(), vin: args.vin.trim(), photoUrl: args.photoUrl,
        status: args.status, mileage: args.mileage, createdAt: new Date(),
      }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateVehicle: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), name: z.string().min(1).optional(), make: z.string().optional(), model: z.string().optional(), year: z.number().int().min(0).max(2100).optional(), plate: z.string().optional(), vin: z.string().optional(), photoUrl: z.string().optional(), status: z.enum(["active", "in_shop", "inactive"]).optional(), mileage: z.number().int().min(0).optional(), oilIntervalMiles: z.number().int().min(0).optional(), oilIntervalMonths: z.number().int().min(0).optional(), lastOilMileage: z.number().int().min(0).nullable().optional(), lastOilDate: z.string().optional(), ezpass: z.number().int().min(0).max(1).optional(), tagNumber: z.string().max(40).optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await requireVehicle(db, args.companyId, args.vehicleId);
      if (args.photoUrl !== undefined && args.photoUrl && !args.photoUrl.startsWith("data:image/")) throw new Error("Only photos captured on the device can be attached.");
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = args.name.trim();
      if (args.make !== undefined) patch.make = args.make.trim();
      if (args.model !== undefined) patch.model = args.model.trim();
      if (args.year !== undefined) patch.year = args.year;
      if (args.plate !== undefined) patch.plate = args.plate.trim();
      if (args.vin !== undefined) patch.vin = args.vin.trim();
      if (args.photoUrl !== undefined) patch.photoUrl = args.photoUrl;
      if (args.status !== undefined) patch.status = args.status;
      if (args.mileage !== undefined) patch.mileage = args.mileage;
      if (args.oilIntervalMiles !== undefined) patch.oilIntervalMiles = args.oilIntervalMiles;
      if (args.oilIntervalMonths !== undefined) patch.oilIntervalMonths = args.oilIntervalMonths;
      if (args.lastOilMileage !== undefined) patch.lastOilMileage = args.lastOilMileage;
      if (args.lastOilDate !== undefined) patch.lastOilDate = args.lastOilDate;
      if (args.ezpass !== undefined) patch.ezpass = args.ezpass;
      if (args.tagNumber !== undefined) patch.tagNumber = args.tagNumber.trim();
      if (Object.keys(patch).length > 0) await db.update(schema.vehicles).set(patch).where(and(eq(schema.vehicles.companyId, args.companyId), eq(schema.vehicles.id, args.vehicleId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteVehicle: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await requireVehicle(db, args.companyId, args.vehicleId);
      await db.delete(schema.vehicleAssignments).where(and(eq(schema.vehicleAssignments.companyId, args.companyId), eq(schema.vehicleAssignments.vehicleId, args.vehicleId)));
      await db.delete(schema.vehicleMileageLogs).where(and(eq(schema.vehicleMileageLogs.companyId, args.companyId), eq(schema.vehicleMileageLogs.vehicleId, args.vehicleId)));
      await db.delete(schema.vehicleFuelLogs).where(and(eq(schema.vehicleFuelLogs.companyId, args.companyId), eq(schema.vehicleFuelLogs.vehicleId, args.vehicleId)));
      await db.delete(schema.vehicleMaintenance).where(and(eq(schema.vehicleMaintenance.companyId, args.companyId), eq(schema.vehicleMaintenance.vehicleId, args.vehicleId)));
      await db.delete(schema.vehicleTickets).where(and(eq(schema.vehicleTickets.companyId, args.companyId), eq(schema.vehicleTickets.vehicleId, args.vehicleId)));
      await db.delete(schema.vehicles).where(and(eq(schema.vehicles.companyId, args.companyId), eq(schema.vehicles.id, args.vehicleId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  assignVehicle: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), employeeId: z.number() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await requireVehicle(db, args.companyId, args.vehicleId);
      const emp = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId))).limit(1);
      if (!emp[0]) throw new Error("Employee not found in this company");
      const existing = await db.select().from(schema.vehicleAssignments)
        .where(and(eq(schema.vehicleAssignments.companyId, args.companyId), eq(schema.vehicleAssignments.vehicleId, args.vehicleId), eq(schema.vehicleAssignments.employeeId, args.employeeId)));
      const current = existing.find((a) => a.unassignedAt === null);
      if (current) return { id: current.id };
      const r = await db.insert(schema.vehicleAssignments).values({ companyId: args.companyId, vehicleId: args.vehicleId, employeeId: args.employeeId, assignedAt: new Date(), unassignedAt: null }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  unassignVehicle: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), employeeId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await db.update(schema.vehicleAssignments).set({ unassignedAt: new Date() })
        .where(and(eq(schema.vehicleAssignments.companyId, args.companyId), eq(schema.vehicleAssignments.vehicleId, args.vehicleId), eq(schema.vehicleAssignments.employeeId, args.employeeId), sql`${schema.vehicleAssignments.unassignedAt} IS NULL`));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addVehicleMileage: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), logDate: z.string().min(1), odometer: z.number().int().min(0), notes: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const v = await requireVehicle(db, args.companyId, args.vehicleId);
      const r = await db.insert(schema.vehicleMileageLogs).values({ companyId: args.companyId, vehicleId: args.vehicleId, logDate: args.logDate, odometer: args.odometer, notes: args.notes, createdAt: new Date() }).$returningId();
      if (args.odometer > v.mileage) {
        await db.update(schema.vehicles).set({ mileage: args.odometer }).where(eq(schema.vehicles.id, v.id));
      }
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  deleteVehicleMileage: defineAction({
    request: z.object({ companyId, actorId: z.number(), logId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await db.delete(schema.vehicleMileageLogs).where(and(eq(schema.vehicleMileageLogs.companyId, args.companyId), eq(schema.vehicleMileageLogs.id, args.logId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addVehicleFuel: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), logDate: z.string().min(1), gallons: z.number().min(0), amount: money, odometer: z.number().int().min(0), projectId: z.number().nullable().default(null), notes: z.string().default(""), receiptPhoto: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireVehicleUser(db, args.companyId, args.actorId, args.vehicleId);
      const v = await requireVehicle(db, args.companyId, args.vehicleId);
      if (args.projectId !== null) {
        const pr = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
        if (!pr[0]) throw new Error("Project not found in this company");
      }
      const r = await db.insert(schema.vehicleFuelLogs).values({ companyId: args.companyId, vehicleId: args.vehicleId, logDate: args.logDate, gallons: args.gallons, amount: args.amount, odometer: args.odometer, projectId: args.projectId, notes: args.notes, receiptPhoto: args.receiptPhoto || null, createdAt: new Date() }).$returningId();
      if (args.odometer > v.mileage) {
        await db.update(schema.vehicles).set({ mileage: args.odometer }).where(eq(schema.vehicles.id, v.id));
      }
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  deleteVehicleFuel: defineAction({
    request: z.object({ companyId, actorId: z.number(), logId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await db.delete(schema.vehicleFuelLogs).where(and(eq(schema.vehicleFuelLogs.companyId, args.companyId), eq(schema.vehicleFuelLogs.id, args.logId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addVehicleMaintenance: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), maintDate: z.string().min(1), type: z.enum(["oil_change", "tires", "brakes", "inspection", "other"]).default("other"), cost: money, vendor: z.string().default(""), odometer: z.number().int().min(0).default(0), notes: z.string().default(""), receiptNote: z.string().default(""), projectId: z.number().nullable().default(null) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const v = await requireVehicle(db, args.companyId, args.vehicleId);
      if (args.projectId !== null) {
        const pr = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId))).limit(1);
        if (!pr[0]) throw new Error("Project not found in this company");
      }
      const r = await db.insert(schema.vehicleMaintenance).values({ companyId: args.companyId, vehicleId: args.vehicleId, maintDate: args.maintDate, type: args.type, cost: args.cost, vendor: args.vendor, odometer: args.odometer, notes: args.notes, receiptNote: args.receiptNote, projectId: args.projectId, createdAt: new Date() }).$returningId();
      // An oil change re-baselines the oil alert (last oil change).
      if (args.type === "oil_change") {
        await db.update(schema.vehicles).set({ lastOilMileage: args.odometer > 0 ? args.odometer : v.mileage, lastOilDate: args.maintDate }).where(eq(schema.vehicles.id, v.id));
      }
      if (args.odometer > v.mileage) {
        await db.update(schema.vehicles).set({ mileage: args.odometer }).where(eq(schema.vehicles.id, v.id));
      }
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  deleteVehicleMaintenance: defineAction({
    request: z.object({ companyId, actorId: z.number(), logId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await db.delete(schema.vehicleMaintenance).where(and(eq(schema.vehicleMaintenance.companyId, args.companyId), eq(schema.vehicleMaintenance.id, args.logId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  addVehicleTicket: defineAction({
    request: z.object({ companyId, actorId: z.number(), vehicleId: z.number(), ticketDate: z.string().min(1), description: z.string().default(""), amount: money, status: z.enum(["open", "paid", "disputed"]).default("open"), employeeId: z.number().nullable().default(null), notes: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await requireVehicle(db, args.companyId, args.vehicleId);
      if (args.employeeId !== null) {
        const emp = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId))).limit(1);
        if (!emp[0]) throw new Error("Employee not found in this company");
      }
      const r = await db.insert(schema.vehicleTickets).values({ companyId: args.companyId, vehicleId: args.vehicleId, ticketDate: args.ticketDate, description: args.description, amount: args.amount, status: args.status, employeeId: args.employeeId, notes: args.notes, createdAt: new Date() }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  updateVehicleTicket: defineAction({
    request: z.object({ companyId, actorId: z.number(), ticketId: z.number(), status: z.enum(["open", "paid", "disputed"]) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const rows = await db.select().from(schema.vehicleTickets).where(and(eq(schema.vehicleTickets.companyId, args.companyId), eq(schema.vehicleTickets.id, args.ticketId))).limit(1);
      if (!rows[0]) throw new Error("Ticket not found");
      await db.update(schema.vehicleTickets).set({ status: args.status }).where(eq(schema.vehicleTickets.id, args.ticketId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteVehicleTicket: defineAction({
    request: z.object({ companyId, actorId: z.number(), ticketId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      await db.delete(schema.vehicleTickets).where(and(eq(schema.vehicleTickets.companyId, args.companyId), eq(schema.vehicleTickets.id, args.ticketId)));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= MATERIALS → INVOICE ================= */
  listProjectMaterials: defineAction({
    request: z.object({ companyId, projectId: z.number() }),
    response: z.object({
      materials: z.array(z.object({
        id: z.number(), item: z.string(), quantity: z.number(), unitCost: z.number(), total: z.number(),
        supplier: z.string(), expenseDate: z.string(), billedInvoiceId: z.number().nullable(), billedInvoiceNumber: z.string(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      const rows = await db.select().from(schema.expenses)
        .where(and(eq(schema.expenses.companyId, args.companyId), eq(schema.expenses.projectId, args.projectId)))
        .orderBy(desc(schema.expenses.id));
      const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      const invNum = new Map(invs.map((i) => [i.id, i.number]));
      return {
        materials: rows.map((e) => ({
          id: e.id, item: e.item, quantity: e.quantity, unitCost: e.unitCost, total: Math.round(e.quantity * e.unitCost),
          supplier: e.supplier, expenseDate: e.expenseDate,
          billedInvoiceId: e.billedInvoiceId, billedInvoiceNumber: e.billedInvoiceId ? (invNum.get(e.billedInvoiceId) ?? "") : "",
        })),
      };
    },
  }),

  /* Marks materials as billed on an invoice. Refuses anything already
     billed elsewhere, so the same material can never be charged twice. */
  markExpensesBilled: defineAction({
    request: z.object({ companyId, actorId: z.number(), invoiceId: z.number(), expenseIds: z.array(z.number()).min(1) }),
    response: z.object({ ok: z.literal(true), marked: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; marked: number }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const inv = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId))).limit(1);
      if (!inv[0]) throw new Error("Invoice not found");
      let marked = 0;
      for (const id of args.expenseIds) {
        const e = await db.select().from(schema.expenses).where(and(eq(schema.expenses.companyId, args.companyId), eq(schema.expenses.id, id))).limit(1);
        if (!e[0]) continue;
        if (e[0].billedInvoiceId !== null) {
          throw new Error(`"${e[0].item}" is already billed on another invoice. Unmark it there first.`);
        }
        if (inv[0].projectId !== null && e[0].projectId !== inv[0].projectId) {
          throw new Error(`"${e[0].item}" belongs to a different project than this invoice.`);
        }
        await db.update(schema.expenses).set({ billedInvoiceId: args.invoiceId }).where(eq(schema.expenses.id, id));
        marked += 1;
      }
      ctx.invalidateQueries();
      return { ok: true as const, marked };
    },
  }),

  /* Unmarking frees the material to be pulled again AND removes the line
     that was pulled from it (matched by the stored expense id), so the
     invoice and the materials list can never disagree. Manager only. */
  unmarkExpenseBilled: defineAction({
    request: z.object({ companyId, actorId: z.number(), expenseId: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await assertTenantWritable(db, args.companyId);
      await requireManager(db, args.companyId, args.actorId);
      const e = await db.select().from(schema.expenses).where(and(eq(schema.expenses.companyId, args.companyId), eq(schema.expenses.id, args.expenseId))).limit(1);
      if (!e[0]) throw new Error("Material not found");
      await db.delete(schema.invoiceItems).where(eq(schema.invoiceItems.expenseId, args.expenseId));
      await db.update(schema.expenses).set({ billedInvoiceId: null }).where(eq(schema.expenses.id, args.expenseId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  /* ================= CLIENT PORTAL (level 5 — STRICTLY READ-ONLY) =================
     Every action here only reads, and every read is scoped to the caller's
     own clientId via requireClientUser. There is deliberately NO portal
     write action: no payments, no task changes, no uploads, no edits. */
  clientLogin: defineAction({
    request: z.object({ email: z.string().min(3), password: z.string().min(1) }),
    response: z.object({ companyId: z.string(), companyName: z.string(), userId: z.number(), userName: z.string(), role: z.literal("cliente"), clientId: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const rows = await db.select().from(schema.employees).where(eq(schema.employees.role, "cliente"));
      const u = rows.find((r) => r.email.trim().toLowerCase() === email);
      if (!u || u.portalEnabled !== 1 || u.status !== "ativo" || u.clientId === null) throw new Error("Invalid email or password.");
      if (!u.portalPassword || u.portalPassword !== hashPortalPassword(args.password)) throw new Error("Invalid email or password.");
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, u.companyId)).limit(1);
      if (!comp[0] || comp[0].status === "suspended") throw new Error("This company is not available right now. Please contact your contractor.");
      return { companyId: u.companyId, companyName: comp[0].name, userId: u.id, userName: u.name, role: "cliente" as const, clientId: u.clientId };
    },
  }),

  employeeLogin: defineAction({
    request: z.object({ email: z.string().min(3), password: z.string().min(1) }),
    response: z.object({ companyId: z.string(), companyName: z.string(), userId: z.number(), userName: z.string(), role: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const email = args.email.trim().toLowerCase();
      const rows = await db.select().from(schema.employees);
      const u = rows.find((r) => r.email.trim().toLowerCase() === email && r.role !== "cliente");
      if (!u || u.portalEnabled !== 1 || u.status !== "ativo") throw new Error("Invalid email or password.");
      if (!u.portalPassword || u.portalPassword !== hashPortalPassword(args.password)) throw new Error("Invalid email or password.");
      const comp = await db.select().from(schema.companies).where(eq(schema.companies.id, u.companyId)).limit(1);
      if (!comp[0] || comp[0].status === "suspended") throw new Error("This company is not available right now.");
      return { companyId: u.companyId, companyName: comp[0].name, userId: u.id, userName: u.name, role: u.role };
    },
  }),

  setEmployeePassword: defineAction({
    request: z.object({ companyId, actorId: z.number(), employeeId: z.number(), password: z.string().min(4) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await requireManager(db, args.companyId, args.actorId);
      await db.update(schema.employees)
        .set({ portalPassword: hashPortalPassword(args.password) })
        .where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.id, args.employeeId)));
      return { ok: true };
    },
  }),

  createClientPortalLogin: defineAction({
    request: z.object({ companyId, actorId: z.number(), clientId: z.number(), email: z.string().min(3), password: z.string().min(6), name: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertTenantWritable(db, args.companyId);
      await requireAdmin(db, args.companyId, args.actorId);
      const cl = await db.select().from(schema.clients).where(and(eq(schema.clients.companyId, args.companyId), eq(schema.clients.id, args.clientId))).limit(1);
      if (!cl[0]) throw new Error("Client not found");
      const email = args.email.trim().toLowerCase();
      const dupe = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      if (dupe.some((e) => e.role === "cliente" && e.email.trim().toLowerCase() === email)) throw new Error("A portal login with this email already exists for this company.");
      const displayName = args.name.trim() || cl[0].contactName || cl[0].name;
      const r = await db.insert(schema.employees).values({ companyId: args.companyId, name: displayName, role: "cliente", trade: "Client portal", phone: cl[0].phone, email, payType: "hora", payRate: 0, status: "ativo", clientId: args.clientId, portalPassword: hashPortalPassword(args.password), portalEnabled: 1 }).$returningId();
      ctx.invalidateQueries();
      return { id: r[0]!.id };
    },
  }),

  listClientPortalLogins: defineAction({
    request: z.object({ companyId, actorId: z.number(), clientId: z.number() }),
    response: z.object({ logins: z.array(z.object({ id: z.number(), name: z.string(), email: z.string(), enabled: z.boolean(), status: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireAdmin(db, args.companyId, args.actorId);
      const rows = await db.select().from(schema.employees).where(and(eq(schema.employees.companyId, args.companyId), eq(schema.employees.role, "cliente"), eq(schema.employees.clientId, args.clientId))).orderBy(asc(schema.employees.id));
      return { logins: rows.map((r) => ({ id: r.id, name: r.name, email: r.email, enabled: r.portalEnabled === 1 && r.status === "ativo", status: r.status })) };
    },
  }),

  updateClientPortalLogin: defineAction({
    request: z.object({ companyId, actorId: z.number(), userId: z.number(), email: z.string().optional(), password: z.string().min(6).optional(), enabled: z.boolean().optional() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await assertTenantWritable(db, args.companyId);
      await requireAdmin(db, args.companyId, args.actorId);
      const target = await getActor(db, args.companyId, args.userId);
      if (!target || target.role !== "cliente") throw new Error("Client portal login not found");
      const patch: Record<string, unknown> = {};
      if (args.email !== undefined) patch.email = args.email.trim().toLowerCase();
      if (args.password !== undefined) patch.portalPassword = hashPortalPassword(args.password);
      if (args.enabled !== undefined) { patch.portalEnabled = args.enabled ? 1 : 0; patch.status = args.enabled ? "ativo" : "inativo"; }
      if (Object.keys(patch).length > 0) await db.update(schema.employees).set(patch).where(eq(schema.employees.id, args.userId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  getClientPortalProjects: defineAction({
    request: z.object({ companyId, userId: z.number() }),
    response: z.object({ projects: z.array(z.object({ id: z.number(), name: z.string(), address: z.string(), status: z.string(), progress: z.number(), coverPhoto: z.string(), startDate: z.string(), endDate: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { client } = await requireClientUser(db, args.companyId, args.userId);
      const projs = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.clientId, client.id))).orderBy(desc(schema.projects.id));
      const jobRows = await db.select().from(schema.jobs).where(eq(schema.jobs.companyId, args.companyId));
      const taskRows = await db.select().from(schema.jobTasks).where(eq(schema.jobTasks.companyId, args.companyId));
      const feed = await db.select().from(schema.progressUpdates).where(eq(schema.progressUpdates.companyId, args.companyId)).orderBy(desc(schema.progressUpdates.id));
      const out = projs.map((p) => {
        const jids = new Set(jobRows.filter((j) => j.projectId === p.id).map((j) => j.id));
        const tasks = taskRows.filter((t) => jids.has(t.jobId));
        const cover = feed.find((f) => f.projectId === p.id && f.photoUrl.startsWith("data:image/"));
        const parts = { streetNumber: p.streetNumber, streetName: p.streetName, city: p.city, state: p.state, zip: p.zip };
        return { id: p.id, name: p.name, address: formatAddress(parts) || p.address, status: p.status, progress: tasks.length > 0 ? clientProjectProgress(tasks) : p.progress, coverPhoto: cover?.photoUrl ?? "", startDate: p.startDate, endDate: p.endDate };
      });
      return { projects: out };
    },
  }),

  getClientProjectDetail: defineAction({
    request: z.object({ companyId, userId: z.number(), projectId: z.number() }),
    response: z.object({
      project: z.object({ id: z.number(), name: z.string(), address: z.string(), status: z.string(), scope: z.string(), progress: z.number(), startDate: z.string(), endDate: z.string() }).nullable(),
      jobs: z.array(z.object({ id: z.number(), name: z.string(), scope: z.string(), status: z.string(), tasks: z.array(z.object({ id: z.number(), title: z.string(), status: z.string() })) })),
      photos: z.array(z.object({ id: z.number(), photoUrl: z.string(), note: z.string(), createdAt: z.string() })),
      services: z.array(z.object({ id: z.number(), serviceName: z.string(), unit: z.string(), quantity: z.number() })),
      plans: z.array(projectPlanOut),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { client } = await requireClientUser(db, args.companyId, args.userId);
      const rows = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, args.projectId), eq(schema.projects.clientId, client.id))).limit(1);
      const p = rows[0];
      if (!p) return { project: null, jobs: [], photos: [], services: [], plans: [] };
      const jobRows = await db.select().from(schema.jobs).where(and(eq(schema.jobs.companyId, args.companyId), eq(schema.jobs.projectId, p.id))).orderBy(asc(schema.jobs.id));
      const allTasks = await db.select().from(schema.jobTasks).where(eq(schema.jobTasks.companyId, args.companyId));
      const jobs = jobRows.map((j) => ({ id: j.id, name: j.name, scope: j.scope, status: j.status, tasks: sortTasks(allTasks.filter((t) => t.jobId === j.id)).map((t) => ({ id: t.id, title: t.title, status: t.status })) }));
      const flatTasks = allTasks.filter((t) => jobRows.some((j) => j.id === t.jobId));
      const feed = await db.select().from(schema.progressUpdates).where(and(eq(schema.progressUpdates.companyId, args.companyId), eq(schema.progressUpdates.projectId, p.id))).orderBy(desc(schema.progressUpdates.id)).limit(30);
      // Task photos are progress evidence too — surface them read-only, no crew info.
      const tp = (await db.select().from(schema.taskPhotos).where(eq(schema.taskPhotos.companyId, args.companyId)).orderBy(desc(schema.taskPhotos.id)))
        .filter((ph) => flatTasks.some((t) => t.id === ph.taskId)).slice(0, 30)
        .map((ph) => ({ id: -ph.id, photoUrl: ph.photoUrl, note: ph.stage, createdAt: ph.createdAt.toISOString() }));
      const photos = [...feed.map((f) => ({ id: f.id, photoUrl: f.photoUrl, note: f.note, createdAt: f.createdAt.toISOString() })), ...tp]
        .filter((f) => f.photoUrl.startsWith("data:image/"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
      const svc = await db.select().from(schema.projectServices).where(and(eq(schema.projectServices.companyId, args.companyId), eq(schema.projectServices.projectId, p.id))).orderBy(asc(schema.projectServices.sortOrder), asc(schema.projectServices.id));
      const planRows = await db.select().from(schema.projectPlans).where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.projectId, p.id))).orderBy(desc(schema.projectPlans.id));
      const parts = { streetNumber: p.streetNumber, streetName: p.streetName, city: p.city, state: p.state, zip: p.zip };
      return {
        project: { id: p.id, name: p.name, address: formatAddress(parts) || p.address, status: p.status, scope: p.scope, progress: flatTasks.length > 0 ? clientProjectProgress(flatTasks) : p.progress, startDate: p.startDate, endDate: p.endDate },
        jobs,
        photos,
        services: svc.map((r) => ({ id: r.id, serviceName: r.serviceName, unit: r.unit, quantity: r.quantity })),
        plans: planRows.map((r) => toProjectPlanOut(r, "")),
      };
    },
  }),

  getClientPlanFile: defineAction({
    request: z.object({ companyId, userId: z.number(), planId: z.number() }),
    response: z.object({ id: z.number(), name: z.string(), mimeType: z.string(), fileData: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { client } = await requireClientUser(db, args.companyId, args.userId);
      const rows = await db.select().from(schema.projectPlans).where(and(eq(schema.projectPlans.companyId, args.companyId), eq(schema.projectPlans.id, args.planId))).limit(1);
      const r = rows[0];
      if (!r) throw new Error("Plan not found");
      const proj = await db.select().from(schema.projects).where(and(eq(schema.projects.companyId, args.companyId), eq(schema.projects.id, r.projectId), eq(schema.projects.clientId, client.id))).limit(1);
      if (!proj[0]) throw new Error("Plan not found");
      return { id: r.id, name: r.name, mimeType: r.mimeType, fileData: r.fileData };
    },
  }),

  getClientInvoices: defineAction({
    request: z.object({ companyId, userId: z.number() }),
    response: z.object({ invoices: z.array(z.object({ id: z.number(), number: z.string(), projectId: z.number().nullable(), projectName: z.string(), issueDate: z.string(), dueDate: z.string(), terms: z.string(), status: z.string(), total: z.number(), paid: z.number(), balance: z.number() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { client } = await requireClientUser(db, args.companyId, args.userId);
      const rows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.clientId, client.id))).orderBy(desc(schema.invoices.id));
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const pm = new Map(projs.map((p) => [p.id, p.name]));
      const out = [];
      for (const inv of rows) {
        const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
        const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
        const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
        const paid = pays.reduce((s, p) => s + p.amount, 0);
        let st = inv.status;
        if (total > 0 && paid >= total) st = "paga"; else if (paid > 0) st = "parcial"; else st = "aberta";
        out.push({ id: inv.id, number: inv.number, projectId: inv.projectId, projectName: inv.projectId ? (pm.get(inv.projectId) ?? "") : "", issueDate: inv.issueDate, dueDate: inv.dueDate, terms: inv.terms ?? "NET 30", status: st, total, paid, balance: total - paid });
      }
      return { invoices: out };
    },
  }),

  getClientInvoiceDetail: defineAction({
    request: z.object({ companyId, userId: z.number(), invoiceId: z.number() }),
    response: z.object({
      invoice: z.object({ id: z.number(), number: z.string(), projectId: z.number().nullable(), projectName: z.string(), projectAddress: z.string(), issueDate: z.string(), dueDate: z.string(), terms: z.string(), status: z.string() }).nullable(),
      from: companyProfileOut.nullable(),
      billTo: z.object({ name: z.string(), contactName: z.string(), phone: z.string(), email: z.string(), email2: z.string(), address: z.string() }).nullable(),
      items: z.array(z.object({ id: z.number(), description: z.string(), quantity: z.number(), unitPrice: z.number(), total: z.number() })),
      payments: z.array(z.object({ id: z.number(), amount: z.number(), payDate: z.string(), method: z.string(), notes: z.string() })),
      total: z.number(), paid: z.number(), balance: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const { client } = await requireClientUser(db, args.companyId, args.userId);
      const rows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.companyId, args.companyId), eq(schema.invoices.id, args.invoiceId), eq(schema.invoices.clientId, client.id))).limit(1);
      const inv = rows[0];
      if (!inv) return { invoice: null, from: null, billTo: null, items: [], payments: [], total: 0, paid: 0, balance: 0 };
      const compRows = await db.select().from(schema.companies).where(eq(schema.companies.id, args.companyId)).limit(1);
      const from = compRows[0] ? toCompanyProfile(compRows[0]) : null;
      const projs = inv.projectId ? await db.select().from(schema.projects).where(eq(schema.projects.id, inv.projectId)).limit(1) : [];
      const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
      const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id)).orderBy(desc(schema.invoicePayments.id));
      const total = items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
      const paid = pays.reduce((s, p) => s + p.amount, 0);
      let st = inv.status;
      if (total > 0 && paid >= total) st = "paga"; else if (paid > 0) st = "parcial"; else st = "aberta";
      const proj = projs[0];
      const projectAddress = proj ? (formatAddress({ streetNumber: proj.streetNumber, streetName: proj.streetName, city: proj.city, state: proj.state, zip: proj.zip }) || proj.address) : "";
      const billTo = { name: client.name, contactName: client.contactName, phone: client.phone, email: client.email, email2: client.email2 ?? "", address: formatAddress({ streetNumber: client.streetNumber, streetName: client.streetName, city: client.city, state: client.state, zip: client.zip }) || client.address };
      return {
        invoice: { id: inv.id, number: inv.number, projectId: inv.projectId, projectName: proj?.name ?? "", projectAddress, issueDate: inv.issueDate, dueDate: inv.dueDate, terms: inv.terms ?? "NET 30", status: st },
        from, billTo,
        items: items.map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, total: Math.round(i.quantity * i.unitPrice) })),
        payments: pays.map((p) => ({ id: p.id, amount: p.amount, payDate: p.payDate, method: p.method, notes: p.notes ?? "" })),
        total, paid, balance: total - paid,
      };
    },
  }),

  getDashboard: defineAction({
    request: z.object({ companyId, actorId: z.number().optional() }),
    response: z.object({
      weekStart: z.string(), weekEnd: z.string(),
      totalHours: z.number(), laborCost: z.number(), materialsCost: z.number(),
      totalCost: z.number(), invoiced: z.number(), received: z.number(), receivable: z.number(),
      profit: z.number(), margin: z.number(),
      pendingApprovals: z.number(), activeProjects: z.number(), totalEmployees: z.number(),
      perProject: z.array(z.object({ projectId: z.number(), projectName: z.string(), hours: z.number(), labor: z.number(), materials: z.number(), total: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await assertInternalActor(db, args);
      await applyAutoClose(db, args.companyId);
      const wb = weekBounds();
      const sheetsAll = await db.select().from(schema.timesheets).where(eq(schema.timesheets.companyId, args.companyId));
      const weekSheets = sheetsAll.filter((s) => s.workDate >= wb.start && s.workDate <= wb.end);
      const approved = weekSheets.filter((s) => s.status === "aprovado");
      const emps = await db.select().from(schema.employees).where(eq(schema.employees.companyId, args.companyId));
      const totalHours = Math.round(approved.reduce((a, s) => a + s.hoursCalc, 0) * 100) / 100;
      // Labor cost uses the pay captured on each approved entry, so later
      // employee pay edits do not rewrite history. Includes contract amounts.
      const laborCost = calcLaborCost(approved);
      const exps = await db.select().from(schema.expenses).where(eq(schema.expenses.companyId, args.companyId));
      const weekExps = exps.filter((e) => e.expenseDate >= wb.start && e.expenseDate <= wb.end);
      const materialsCost = weekExps.reduce((s, e) => s + Math.round(e.quantity * e.unitCost), 0);
      const invs = await db.select().from(schema.invoices).where(eq(schema.invoices.companyId, args.companyId));
      let invoiced = 0; let received = 0;
      for (const inv of invs) {
        const items = await db.select().from(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, inv.id));
        const pays = await db.select().from(schema.invoicePayments).where(eq(schema.invoicePayments.invoiceId, inv.id));
        invoiced += items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice), 0);
        received += pays.reduce((s, p) => s + p.amount, 0);
      }
      const receivable = invoiced - received;
      const totalCost = laborCost + materialsCost;
      const profit = received - totalCost;
      const margin = received > 0 ? Math.round((profit / received) * 1000) / 10 : 0;
      const pendingApprovals = sheetsAll.filter((s) => s.status === "pendente").length;
      const projs = await db.select().from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      const perProject = projs.map((p) => {
        const ps = approved.filter((s) => s.projectId === p.id);
        const hours = Math.round(ps.reduce((a, s) => a + s.hoursCalc, 0) * 100) / 100;
        const labor = calcLaborCost(ps);
        const mats = exps.filter((e) => e.projectId === p.id).reduce((s, e) => s + Math.round(e.quantity * e.unitCost), 0);
        return { projectId: p.id, projectName: p.name, hours, labor, materials: mats, total: labor + mats };
      }).filter((r) => r.total > 0 || r.hours > 0);
      // Managers run the work, not the money: strip every cost/financial
      // figure for gerente (owner keeps the full dashboard).
      const actorRow = args.actorId !== undefined ? await getActor(db, args.companyId, args.actorId) : null;
      const hideMoney = actorRow?.role === "gerente";
      return {
        weekStart: wb.start, weekEnd: wb.end,
        totalHours, laborCost: hideMoney ? 0 : laborCost, materialsCost: hideMoney ? 0 : materialsCost, totalCost: hideMoney ? 0 : totalCost,
        invoiced: hideMoney ? 0 : invoiced, received: hideMoney ? 0 : received, receivable: hideMoney ? 0 : receivable, profit: hideMoney ? 0 : profit, margin: hideMoney ? 0 : margin,
        pendingApprovals,
        activeProjects: projs.filter((p) => p.status === "andamento").length,
        totalEmployees: emps.filter((e) => e.status === "ativo").length,
        perProject: hideMoney ? perProject.map((r) => ({ ...r, labor: 0, materials: 0, total: 0 })) : perProject,
      };
    },
  }),

  // --- Subscription management (platform owner only) ---
  getSubscriptionOverview: defineAction({
    request: z.object({ ownerEmail: z.string() }),
    response: z.object({
      builders: z.array(z.object({
        companyId: z.string(), companyName: z.string(), code: z.string(), status: z.string(),
        userCount: z.number(), billableUsers: z.number(),
        weeklyFeeCents: z.number(),
        totalPaidCents: z.number(), lastPaymentDate: z.string().nullable(),
      })),
      totalWeeklyCents: z.number(),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireOwner(db, args.ownerEmail);
      const comps = await db.select().from(schema.companies).orderBy(asc(schema.companies.name));
      const builders = [];
      let totalWeeklyCents = 0;
      for (const c of comps) {
        const users = await db.select({ id: schema.employees.id, role: schema.employees.role })
          .from(schema.employees).where(eq(schema.employees.companyId, c.id));
        const billable = users.filter((u) => u.role !== "cliente").length;
        const pays = await db.select()
          .from(schema.subscriptionPayments)
          .where(eq(schema.subscriptionPayments.companyId, c.id))
          .orderBy(desc(schema.subscriptionPayments.paidDate));
        const totalPaidCents = pays.reduce((s, p) => s + p.amountCents, 0);
        builders.push({
          companyId: c.id, companyName: c.name, code: c.code, status: c.status,
          userCount: users.length, billableUsers: billable,
          weeklyFeeCents: c.weeklyFeeCents ?? 0,
          totalPaidCents,
          lastPaymentDate: pays.length > 0 ? pays[0]!.paidDate : null,
        });
        totalWeeklyCents += (c.weeklyFeeCents ?? 0) * billable;
      }
      return { builders, totalWeeklyCents };
    },
  }),

  setWeeklyFee: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string(), weeklyFeeCents: z.number().int().min(0) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireOwner(db, args.ownerEmail);
      await db.update(schema.companies)
        .set({ weeklyFeeCents: args.weeklyFeeCents })
        .where(eq(schema.companies.id, args.companyId));
      return { ok: true };
    },
  }),

  recordSubscriptionPayment: defineAction({
    request: z.object({
      ownerEmail: z.string(), companyId: z.string(),
      amountCents: z.number().int().min(1), paidDate: z.string(), notes: z.string().max(255),
    }),
    response: z.object({ ok: z.boolean(), id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const owner = await requireOwner(db, args.ownerEmail);
      const now = Date.now();
      const res = await db.insert(schema.subscriptionPayments).values({
        companyId: args.companyId, amountCents: args.amountCents,
        paidDate: args.paidDate, notes: args.notes,
        recordedBy: owner.id, createdAt: now,
      });
      const id = Number((res as unknown as { insertId: unknown }).insertId ?? 0);
      return { ok: true, id };
    },
  }),

  listSubscriptionPayments: defineAction({
    request: z.object({ ownerEmail: z.string(), companyId: z.string() }),
    response: z.object({
      payments: z.array(z.object({
        id: z.number(), amountCents: z.number(), paidDate: z.string(),
        notes: z.string(), createdAt: z.number(),
      })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireOwner(db, args.ownerEmail);
      const rows = await db.select()
        .from(schema.subscriptionPayments)
        .where(eq(schema.subscriptionPayments.companyId, args.companyId))
        .orderBy(desc(schema.subscriptionPayments.paidDate), desc(schema.subscriptionPayments.id));
      return {
        payments: rows.map((r) => ({
          id: r.id, amountCents: r.amountCents, paidDate: r.paidDate,
          notes: r.notes ?? "", createdAt: r.createdAt,
        })),
      };
    },
  }),

  // --- Costs (admin/manager): per-project and general ---
  getCosts: defineAction({
    request: z.object({ companyId: z.string(), actorId: z.number() }),
    response: z.object({
      perProject: z.array(z.object({
        projectId: z.number(), projectName: z.string(),
        laborCents: z.number(), materialsCents: z.number(), fleetCents: z.number(),
        totalCents: z.number(),
      })),
      general: z.object({
        laborCents: z.number(), materialsCents: z.number(), fleetCents: z.number(),
        totalCents: z.number(),
      }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await requireManager(db, args.companyId, args.actorId);
      const projs = await db.select({ id: schema.projects.id, name: schema.projects.name })
        .from(schema.projects).where(eq(schema.projects.companyId, args.companyId));
      // Labor from approved timesheets (hours x rate snapshot)
      const sheets = await db.select({
        projectId: schema.timesheets.projectId,
        hours: schema.timesheets.hoursCalc,
        rate: schema.timesheets.payRateSnapshot,
        payType: schema.timesheets.payTypeSnapshot,
        status: schema.timesheets.status,
      }).from(schema.timesheets).where(eq(schema.timesheets.companyId, args.companyId));
      const laborByProject = new Map<number, number>();
      let laborTotal = 0;
      for (const s of sheets) {
        if (s.status !== "aprovado") continue;
        // hora: hours x rate; diaria/contrato: rate is per-day/contract, count 1x if hours > 0
        const cost = s.payType === "hora" ? Math.round(s.hours * s.rate) : (s.hours > 0 ? s.rate : 0);
        laborByProject.set(s.projectId, (laborByProject.get(s.projectId) ?? 0) + cost);
        laborTotal += cost;
      }
      // Materials from expenses
      const exps = await db.select({
        projectId: schema.expenses.projectId,
        qty: schema.expenses.quantity, unitCost: schema.expenses.unitCost,
      }).from(schema.expenses).where(eq(schema.expenses.companyId, args.companyId));
      const matByProject = new Map<number, number>();
      let matTotal = 0;
      for (const e of exps) {
        const cost = Math.round(e.qty * e.unitCost);
        matByProject.set(e.projectId, (matByProject.get(e.projectId) ?? 0) + cost);
        matTotal += cost;
      }
      // Fleet: fuel + maintenance + tickets (project-linked)
      const fuel = await db.select({ projectId: schema.vehicleFuelLogs.projectId, amount: schema.vehicleFuelLogs.amount })
        .from(schema.vehicleFuelLogs).where(eq(schema.vehicleFuelLogs.companyId, args.companyId));
      const maint = await db.select({ projectId: schema.vehicleMaintenance.projectId, cost: schema.vehicleMaintenance.cost })
        .from(schema.vehicleMaintenance).where(eq(schema.vehicleMaintenance.companyId, args.companyId));
      const ticks = await db.select({ amount: schema.vehicleTickets.amount })
        .from(schema.vehicleTickets).where(eq(schema.vehicleTickets.companyId, args.companyId));
      const fleetByProject = new Map<number, number>();
      let fleetTotal = 0;
      const addFleet = (pid: number | null, amt: number) => {
        fleetTotal += amt;
        if (pid !== null && pid !== undefined) fleetByProject.set(pid, (fleetByProject.get(pid) ?? 0) + amt);
      };
      for (const f of fuel) addFleet(f.projectId, f.amount);
      for (const m of maint) addFleet(m.projectId, m.cost);
      for (const t of ticks) fleetTotal += t.amount ?? 0;
      const perProject = projs.map((p) => {
        const laborCents = laborByProject.get(p.id) ?? 0;
        const materialsCents = matByProject.get(p.id) ?? 0;
        const fleetCents = fleetByProject.get(p.id) ?? 0;
        return { projectId: p.id, projectName: p.name, laborCents, materialsCents, fleetCents, totalCents: laborCents + materialsCents + fleetCents };
      }).sort((a, b) => b.totalCents - a.totalCents);
      return {
        perProject,
        general: { laborCents: laborTotal, materialsCents: matTotal, fleetCents: fleetTotal, totalCents: laborTotal + matTotal + fleetTotal },
      };
    },
  }),
} satisfies ActionsModule;
