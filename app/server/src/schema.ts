import { bigint, customType, double, int, longtext, mysqlEnum, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

/* MySQL port of the pilot's SQLite schema (same tables, same columns).
   Columns the pilot stores as ms-epoch integers with drizzle's
   `timestamp_ms` mode stay BIGINT ms-epoch columns here; the custom type
   below converts Date <-> ms so the action layer is unchanged. Date-only
   fields stay 'YYYY-MM-DD' strings, money stays integer cents — exactly
   the pilot's semantics. */

// ms-epoch BIGINT that behaves like SQLite's integer({ mode: "timestamp_ms" })
const timestampMs = customType<{ data: Date; driverData: number }>({
  dataType() {
    return "bigint";
  },
  toDriver(value: Date): number {
    return value.getTime();
  },
  fromDriver(value: number): Date {
    return new Date(Number(value));
  },
});

// --- Companies (tenants) ---
export const companies = mysqlTable("companies", {
  id: varchar("id", { length: 64 }).primaryKey(), // BUILDER001 / BUILDER002
  name: varchar("name", { length: 191 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  // Tenant lifecycle (managed from the platform-owner panel)
  status: mysqlEnum("status", ["trial", "active", "suspended"]).notNull().default("trial"),
  plan: varchar("plan", { length: 64 }).notNull().default("Pilot"),
  createdAt: int("created_at").notNull().default(0), // ms epoch, 0 = unset
  // Company profile — renders as the invoice header "from" block
  phone: varchar("phone", { length: 40 }).notNull().default(""),
  email: varchar("email", { length: 190 }).notNull().default(""),
  address: text("address").notNull().default(""),
  streetNumber: varchar("street_number", { length: 20 }).notNull().default(""),
  streetName: varchar("street_name", { length: 160 }).notNull().default(""),
  city: varchar("city", { length: 100 }).notNull().default(""),
  state: varchar("state", { length: 40 }).notNull().default(""),
  zip: varchar("zip", { length: 12 }).notNull().default(""),
  // Invoice accent color (per company) — used on the printed invoice sheet:
  // header band, table header row, dividers, and the Balance Due highlight.
  invoiceAccentColor: varchar("invoice_accent_color", { length: 16 }).notNull().default("#F97316"),
  // Company logo (per tenant): inline device image data URL (same storage
  // pattern as task photos), resized client-side before upload. Shown on
  // the invoice header and the company profile; empty = name-only header.
  logoUrl: longtext("logo_url").notNull().default(""),
  // 1 once the starter services catalog has been seeded for this tenant,
  // so deleting every service later never re-seeds it.
  servicesSeeded: int("services_seeded").notNull().default(0),
  // 1 once the demo fleet (2 vehicles) has been seeded for this tenant.
  fleetSeeded: int("fleet_seeded").notNull().default(0),
  // Owner-set weekly subscription fee in cents.
  weeklyFeeCents: int("weekly_fee_cents").notNull().default(0),
});

// --- Subscription payments (recorded by platform owner, per tenant) ---
export const subscriptionPayments = mysqlTable("subscription_payments", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  amountCents: int("amount_cents").notNull(),
  paidDate: varchar("paid_date", { length: 10 }).notNull(),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  recordedBy: int("recorded_by").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// --- Platform owners (SmartBuilder super-admins, separate from tenants) ---
export const platformOwners = mysqlTable("platform_owners", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 190 }).notNull(),
  name: varchar("name", { length: 120 }).notNull().default(""),
});

// --- Clients of a company ---
export const clients = mysqlTable("clients", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  contactName: varchar("contact_name", { length: 120 }).notNull().default(""),
  phone: varchar("phone", { length: 40 }).notNull().default(""),
  email: varchar("email", { length: 190 }).notNull().default(""),
  email2: varchar("email2", { length: 190 }).notNull().default(""), // additional email (second bill-to recipient)
  address: text("address").notNull().default(""), // legacy free-text; formatted address is composed from the fields below
  // Structured billing address (US format)
  streetNumber: varchar("street_number", { length: 20 }).notNull().default(""),
  streetName: varchar("street_name", { length: 160 }).notNull().default(""),
  city: varchar("city", { length: 100 }).notNull().default(""),
  state: varchar("state", { length: 40 }).notNull().default(""),
  zip: varchar("zip", { length: 12 }).notNull().default(""),
});

// --- Employees / users ---
// Roles (5-level access model):
//  admin = Company owner (full access inside the company)
//  gerente = Manager (distributes work; no payroll/costs/invoice financials)
//  funcionario = Employee (field only)
//  cliente = Client portal (STRICTLY read-only, scoped to clientId)
export const employees = mysqlTable("employees", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  role: mysqlEnum("role", ["admin", "gerente", "funcionario", "cliente"]).notNull().default("funcionario"),
  // Client portal linkage: only set when role = "cliente". The portal user
  // sees ONLY this client's projects and invoices, read-only.
  clientId: int("client_id"),
  portalPassword: varchar("portal_password", { length: 128 }).notNull().default(""), // sha256 hex, never plaintext
  portalEnabled: int("portal_enabled").notNull().default(1),
  trade: varchar("trade", { length: 120 }).notNull().default(""),
  phone: varchar("phone", { length: 40 }).notNull().default(""),
  email: varchar("email", { length: 190 }).notNull().default(""),
  payType: mysqlEnum("pay_type", ["hora", "diaria", "contrato"]).notNull().default("hora"),
  payRate: int("pay_rate").notNull().default(0), // in cents
  status: mysqlEnum("status", ["ativo", "inativo"]).notNull().default("ativo"),
});

// --- Projects (Obras) ---
export const projects = mysqlTable("projects", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  clientId: int("client_id"),
  name: varchar("name", { length: 191 }).notNull(),
  scope: text("scope").notNull().default(""),
  address: text("address").notNull().default(""), // legacy free-text; formatted address is composed from the fields below
  // Structured job-site address (US format)
  streetNumber: varchar("street_number", { length: 20 }).notNull().default(""),
  streetName: varchar("street_name", { length: 160 }).notNull().default(""),
  city: varchar("city", { length: 100 }).notNull().default(""),
  state: varchar("state", { length: 40 }).notNull().default(""),
  zip: varchar("zip", { length: 12 }).notNull().default(""),
  status: mysqlEnum("status", ["planejada", "andamento", "pausada", "concluida"]).notNull().default("andamento"),
  startDate: varchar("start_date", { length: 10 }).notNull().default(""),
  endDate: varchar("end_date", { length: 10 }).notNull().default(""),
  budget: int("budget").notNull().default(0), // cents — internal cost budget
  estimatedValue: int("estimated_value").notNull().default(0), // cents — contract / quoted price (what the client pays)
  progress: int("progress").notNull().default(0), // 0-100
  // Cerca virtual (geofence) da obra: centro + raio em metros.
  geoLat: double("geo_lat"),
  geoLng: double("geo_lng"),
  geoRadius: int("geo_radius").notNull().default(200),
});

// --- Jobs (trades) inside a project — e.g. Roof and Siding on the same site ---
export const jobs = mysqlTable("jobs", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  // Linked catalog service (nullable: custom/one-off jobs keep serviceId
  // null and their free-text name). The name stays the display label —
  // seeded from the service name when picked, still editable afterwards.
  serviceId: int("service_id"),
  name: varchar("name", { length: 191 }).notNull(), // e.g. "Roof replacement", "Siding installation"
  scope: text("scope").notNull().default(""), // "What to do" for this job's crew
  status: mysqlEnum("status", ["scheduled", "in_progress", "done"]).notNull().default("scheduled"),
  startDate: varchar("start_date", { length: 10 }).notNull().default(""),
  endDate: varchar("end_date", { length: 10 }).notNull().default(""),
  estimatedValue: int("estimated_value").notNull().default(0), // cents — optional, per-job quoted price
});

// --- Tasks (checklist) inside a job ---
// assigneeId null = whole job crew. Status drives started/completed instants;
// In Progress can span several days until the worker marks Done.
export const jobTasks = mysqlTable("job_tasks", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  jobId: int("job_id").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  notes: text("notes").notNull().default(""),
  assigneeId: int("assignee_id"),
  status: mysqlEnum("status", ["todo", "in_progress", "done"]).notNull().default("todo"),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
  startedAt: timestampMs("started_at"),
  completedAt: timestampMs("completed_at"),
});

// --- Task assignees (many employees per task) ---
// One row per (task, employee). An empty set for a task means "whole crew"
// (or Unassigned when the job has no crew yet) — the same meaning the old
// nullable job_tasks.assignee_id carried. The legacy column stays synced
// (first assignee or null) for export/back-compat.
export const taskAssignees = mysqlTable("task_assignees", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  taskId: int("task_id").notNull(),
  employeeId: int("employee_id").notNull(),
});

// --- Photos attached to a task (Before / During / After the work) ---
// photoUrl follows the progress_updates pattern: inline device image
// (data:image/...), never an external URL.
export const taskPhotos = mysqlTable("task_photos", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  taskId: int("task_id").notNull(),
  employeeId: int("employee_id").notNull(), // who uploaded it
  photoUrl: longtext("photo_url").notNull(),
  stage: mysqlEnum("stage", ["before", "during", "after"]).notNull().default("during"),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Assignments (employee <-> project, optionally to a specific job) ---
// jobId null = assigned to the project as a whole; jobId set = assigned to
// that job (the employee is also part of the project crew).
export const assignments = mysqlTable("assignments", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  jobId: int("job_id"),
  employeeId: int("employee_id").notNull(),
});

// --- Timesheets / Check-in out ---
export const timesheets = mysqlTable("timesheets", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  jobId: int("job_id"), // null = project-level entry (no specific job picked)
  employeeId: int("employee_id").notNull(),
  checkInAt: timestampMs("check_in_at").notNull(),
  checkOutAt: timestampMs("check_out_at"),
  inLat: double("in_lat"),
  inLng: double("in_lng"),
  outLat: double("out_lat"),
  outLng: double("out_lng"),
  // Validação da cerca virtual: "dentro" | "fora" | "sem_gps" | "sem_cerca"
  inZone: varchar("in_zone", { length: 16 }).notNull().default(""),
  outZone: varchar("out_zone", { length: 16 }).notNull().default(""),
  // Distância (m) do ponto até o centro da cerca da obra, quando calculável
  inDistM: int("in_dist_m"),
  outDistM: int("out_dist_m"),
  // 1 = encerrado automaticamente no horário-limite (padrão 17:00)
  autoClosed: int("auto_closed").notNull().default(0),
  hoursCalc: double("hours_calc").notNull().default(0),
  // Pay captured when the work was recorded. Future edits to the employee's
  // pay type/rate must not rewrite approved payroll history.
  payTypeSnapshot: mysqlEnum("pay_type_snapshot", ["hora", "diaria", "contrato"]).notNull().default("hora"),
  payRateSnapshot: int("pay_rate_snapshot").notNull().default(0),
  status: mysqlEnum("status", ["aberto", "pendente", "aprovado", "rejeitado"]).notNull().default("aberto"),
  note: text("note").notNull().default(""),
  workDate: varchar("work_date", { length: 10 }).notNull(), // YYYY-MM-DD
});

// --- Location pings (trilha de GPS enquanto o app está aberto) ---
export const locationPings = mysqlTable("location_pings", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  timesheetId: int("timesheet_id"),
  employeeId: int("employee_id").notNull(),
  lat: double("lat").notNull(),
  lng: double("lng").notNull(),
  distM: int("dist_m"),
  zone: varchar("zone", { length: 16 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Timesheet adjustments (log de ajustes feitos por gerente/admin) ---
export const timesheetAdjustments = mysqlTable("timesheet_adjustments", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  timesheetId: int("timesheet_id").notNull(),
  adjustedBy: int("adjusted_by").notNull(), // employee id do gerente/admin
  adjustedByName: varchar("adjusted_by_name", { length: 191 }).notNull().default(""),
  oldCheckInAt: timestampMs("old_check_in_at").notNull(),
  newCheckInAt: timestampMs("new_check_in_at").notNull(),
  oldCheckOutAt: timestampMs("old_check_out_at"),
  newCheckOutAt: timestampMs("new_check_out_at"),
  oldHours: double("old_hours").notNull().default(0),
  newHours: double("new_hours").notNull().default(0),
  reason: varchar("reason", { length: 255 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Company settings (regras de ponto) ---
export const companySettings = mysqlTable("company_settings", {
  companyId: varchar("company_id", { length: 64 }).primaryKey(),
  noShowCutoff: varchar("no_show_cutoff", { length: 5 }).notNull().default("09:00"), // HH:MM — sem registro após este horário
  autoCloseTime: varchar("auto_close_time", { length: 5 }).notNull().default("17:00"), // HH:MM — encerramento automático
  // Overtime (hourly employees only): daily + weekly thresholds, multiplier.
  otEnabled: int("ot_enabled").notNull().default(0),
  otDailyHours: double("ot_daily_hours").notNull().default(8),
  otWeeklyHours: double("ot_weekly_hours").notNull().default(40),
  otMultiplier: double("ot_multiplier").notNull().default(1.5),
});

// --- Progress updates (photos/notes) ---
export const progressUpdates = mysqlTable("progress_updates", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  employeeId: int("employee_id").notNull(),
  note: text("note").notNull().default(""),
  photoUrl: longtext("photo_url").notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Materials / Expenses ---
export const expenses = mysqlTable("expenses", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  item: varchar("item", { length: 255 }).notNull(),
  quantity: double("quantity").notNull().default(1),
  unitCost: int("unit_cost").notNull().default(0), // cents
  supplier: varchar("supplier", { length: 191 }).notNull().default(""),
  expenseDate: varchar("expense_date", { length: 10 }).notNull(),
  receiptNote: text("receipt_note").notNull().default(""),
  // Set when this material was pulled onto an invoice (prevents double-billing)
  billedInvoiceId: int("billed_invoice_id"),
});

// --- Invoices ---
export const invoices = mysqlTable("invoices", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  clientId: int("client_id"),
  projectId: int("project_id"),
  number: varchar("number", { length: 40 }).notNull(),
  issueDate: varchar("issue_date", { length: 10 }).notNull(),
  dueDate: varchar("due_date", { length: 10 }).notNull(),
  terms: varchar("terms", { length: 40 }).notNull().default("NET 30"),
  status: mysqlEnum("status", ["aberta", "parcial", "paga", "vencida"]).notNull().default("aberta"),
});

export const invoiceItems = mysqlTable("invoice_items", {
  id: int("id").primaryKey().autoincrement(),
  invoiceId: int("invoice_id").notNull(),
  description: text("description").notNull(),
  quantity: double("quantity").notNull().default(1),
  unitPrice: int("unit_price").notNull().default(0), // cents
  // When this line was pulled from a material/expense, the source expense id
  expenseId: int("expense_id"),
});

export const invoicePayments = mysqlTable("invoice_payments", {
  id: int("id").primaryKey().autoincrement(),
  invoiceId: int("invoice_id").notNull(),
  amount: int("amount").notNull().default(0), // cents
  payDate: varchar("pay_date", { length: 10 }).notNull(),
  method: varchar("method", { length: 60 }).notNull().default("Check"),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
});

// --- In-app notifications (per recipient; push comes with the native app) ---
// One row per recipient employee. dedupeKey makes the lazy scans (no-show,
// overdue invoices, pending approvals) idempotent.
export const notifications = mysqlTable("notifications", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  userId: int("user_id").notNull(), // recipient employee id
  type: varchar("type", { length: 32 }).notNull(), // out_of_zone | no_show | task_done | task_assigned | timesheet_pending | invoice_overdue | invoice_payment
  title: varchar("title", { length: 255 }).notNull(),
  detail: text("detail").notNull().default(""),
  payload: text("payload").notNull().default(""), // JSON with structured fields so the client can localize title/detail per language
  linkView: varchar("link_view", { length: 24 }).notNull().default(""), // invoices | projects | entries | payroll | field
  linkId: int("link_id"), // record id inside linkView (invoice/project/sheet)
  readAt: timestampMs("read_at"),
  dedupeKey: varchar("dedupe_key", { length: 191 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Payroll payouts: one row = one employee paid for one Mon–Sun period.
// The existence of a row locks that employee+period (no recalculation). ---
export const payrollPayouts = mysqlTable("payroll_payouts", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  employeeId: int("employee_id").notNull(),
  periodStart: varchar("period_start", { length: 10 }).notNull(), // YYYY-MM-DD (Monday)
  periodEnd: varchar("period_end", { length: 10 }).notNull(), // YYYY-MM-DD (Sunday)
  hours: double("hours").notNull().default(0),
  regularHours: double("regular_hours").notNull().default(0),
  otHours: double("ot_hours").notNull().default(0),
  otMultiplier: double("ot_multiplier").notNull().default(1),
  days: int("days").notNull().default(0),
  gross: int("gross").notNull().default(0), // cents
  payType: varchar("pay_type", { length: 24 }).notNull().default("hora"),
  payRate: int("pay_rate").notNull().default(0), // cents
  paidDate: varchar("paid_date", { length: 10 }).notNull(),
  method: varchar("method", { length: 40 }).notNull().default("Check"),
  reference: varchar("reference", { length: 120 }).notNull().default(""),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  paidAmount: int("paid_amount").notNull().default(0), // cents actually paid (balance = gross - paidAmount)
  createdBy: int("created_by").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Payroll advances (vales) ---
export const payrollAdvances = mysqlTable("payroll_advances", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  employeeId: int("employee_id").notNull(),
  amount: int("amount").notNull(), // cents
  advanceDate: varchar("advance_date", { length: 10 }).notNull(),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  deducted: int("deducted").notNull().default(0), // 1 = deducted from a payout
  deductedPayoutId: int("deducted_payout_id"),
  createdBy: int("created_by").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Time logged against a task: timer segments + manual hour logs ---
export const taskTimeLogs = mysqlTable("task_time_logs", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  taskId: int("task_id").notNull(),
  employeeId: int("employee_id").notNull(),
  kind: mysqlEnum("kind", ["timer", "manual"]).notNull().default("timer"),
  startedAt: timestampMs("started_at"),
  endedAt: timestampMs("ended_at"),
  minutes: double("minutes").notNull().default(0), // set when the segment closes / on manual log
  note: varchar("note", { length: 255 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Services catalog (per tenant) ---
// Reusable kinds of work a company sells/measures, e.g. "Hardwood floor"
// billed per sq ft. `unit` is a preset ("sq ft", "linear ft", "sq",
// "each", "hours") or a custom label typed by the manager. defaultRate is
// cents per unit, 0 = no default rate.
export const services = mysqlTable("services", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  unit: varchar("unit", { length: 40 }).notNull().default("sq ft"),
  defaultRate: int("default_rate").notNull().default(0), // cents per unit
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Service types & phases ---
// A service type is a main category (e.g. "Hardwood Floors"). Each type
// has ordered phases (e.g. 1. Initial Inspection & Measurements, 2. Site
// Preparation & Demolition, ...). Used to organize the services catalog
// and to guide project setup.
export const serviceTypes = mysqlTable("service_types", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});
export const servicePhases = mysqlTable("service_phases", {
  id: int("id").primaryKey().autoincrement(),
  typeId: int("type_id").notNull(),
  phaseNumber: int("phase_number").notNull(),
  name: varchar("name", { length: 191 }).notNull(),
  description: varchar("description", { length: 500 }),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Required services & measurements on a project ---
// One line = "this project needs X of service Y" (e.g. Hardwood floor —
// 400 sq ft). Service name/unit/rate are snapshotted onto the line so the
// measurement survives later catalog edits or deletion. Shown read-only
// to the crew in the field.
export const projectServices = mysqlTable("project_services", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  serviceId: int("service_id"),
  serviceName: varchar("service_name", { length: 191 }).notNull(),
  unit: varchar("unit", { length: 40 }).notNull().default("sq ft"),
  quantity: double("quantity").notNull().default(0),
  rate: int("rate").notNull().default(0), // cents per unit, snapshot
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Plans & blueprints uploaded to a project ---
// fileData is an inline data URL (same owned-storage pattern as task
// photos and the company logo): PDF stays a PDF data URL, images are
// downscaled client-side before upload. thumbnailData is a small image
// data URL for the list preview (empty for PDFs).
export const projectPlans = mysqlTable("project_plans", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  projectId: int("project_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull().default(""),
  fileData: longtext("file_data").notNull().default(""),
  thumbnailData: longtext("thumbnail_data").notNull().default(""),
  fileSize: int("file_size").notNull().default(0), // original bytes
  uploadedBy: int("uploaded_by").notNull().default(0), // employee id
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// --- Fleet / vehicles (per tenant) ---
// One row per vehicle. photoUrl follows the same inline device-image
// pattern as task photos (data:image/...), never an external URL.
// mileage is the current odometer in miles (US standard).
export const vehicles = mysqlTable("vehicles", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(), // unit name/number, e.g. "Truck 3"
  make: varchar("make", { length: 80 }).notNull().default(""),
  model: varchar("model", { length: 80 }).notNull().default(""),
  year: int("year").notNull().default(0),
  plate: varchar("plate", { length: 20 }).notNull().default(""),
  vin: varchar("vin", { length: 32 }).notNull().default(""),
  photoUrl: longtext("photo_url").notNull().default(""),
  status: mysqlEnum("status", ["active", "in_shop", "inactive"]).notNull().default("active"),
  mileage: int("mileage").notNull().default(0), // current odometer, miles
  // Oil-change alert settings: due every N miles and/or N months after the
  // last oil change (whichever comes first).
  oilIntervalMiles: int("oil_interval_miles").notNull().default(5000),
  oilIntervalMonths: int("oil_interval_months").notNull().default(6),
  lastOilMileage: int("last_oil_mileage"), // odometer at last oil change
  lastOilDate: varchar("last_oil_date", { length: 10 }).notNull().default(""), // YYYY-MM-DD
  ezpass: int("ezpass").notNull().default(0), // 1 = has EZPass
  tagNumber: varchar("tag_number", { length: 40 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// Who has (or had) a vehicle. unassignedAt null = currently using it; a
// vehicle can be with several employees at once (shared crew truck).
export const vehicleAssignments = mysqlTable("vehicle_assignments", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  vehicleId: int("vehicle_id").notNull(),
  employeeId: int("employee_id").notNull(),
  assignedAt: timestampMs("assigned_at").notNull().$defaultFn(() => new Date()),
  unassignedAt: timestampMs("unassigned_at"),
});

// Odometer readings over time (each entry can also bump the vehicle's
// current mileage when it is the highest reading).
export const vehicleMileageLogs = mysqlTable("vehicle_mileage_logs", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  vehicleId: int("vehicle_id").notNull(),
  logDate: varchar("log_date", { length: 10 }).notNull(), // YYYY-MM-DD
  odometer: int("odometer").notNull().default(0), // miles
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// Fuel fills. MPG for a fill = miles since previous fill / gallons.
// projectId optionally links the cost to a project.
export const vehicleFuelLogs = mysqlTable("vehicle_fuel_logs", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  vehicleId: int("vehicle_id").notNull(),
  logDate: varchar("log_date", { length: 10 }).notNull(), // YYYY-MM-DD
  gallons: double("gallons").notNull().default(0),
  amount: int("amount").notNull().default(0), // cents
  odometer: int("odometer").notNull().default(0), // miles at fill
  projectId: int("project_id"),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  receiptPhoto: text("receipt_photo"), // photo of gas receipt (data URL), nullable for MySQL 8.4
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// Maintenance / shop work. projectId optionally links the cost to a project.
export const vehicleMaintenance = mysqlTable("vehicle_maintenance", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  vehicleId: int("vehicle_id").notNull(),
  maintDate: varchar("maint_date", { length: 10 }).notNull(), // YYYY-MM-DD
  type: mysqlEnum("type", ["oil_change", "tires", "brakes", "inspection", "other"]).notNull().default("other"),
  cost: int("cost").notNull().default(0), // cents
  vendor: varchar("vendor", { length: 191 }).notNull().default(""),
  odometer: int("odometer").notNull().default(0), // miles
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  receiptNote: text("receipt_note").notNull().default(""), // receipt reference / note
  projectId: int("project_id"),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// Tickets / fines against a vehicle. employeeId = who was responsible
// (had the vehicle) at the time, snapshotted at creation.
export const vehicleTickets = mysqlTable("vehicle_tickets", {
  id: int("id").primaryKey().autoincrement(),
  companyId: varchar("company_id", { length: 64 }).notNull(),
  vehicleId: int("vehicle_id").notNull(),
  ticketDate: varchar("ticket_date", { length: 10 }).notNull(), // YYYY-MM-DD
  description: text("description").notNull().default(""),
  amount: int("amount").notNull().default(0), // cents
  status: mysqlEnum("status", ["open", "paid", "disputed"]).notNull().default("open"),
  employeeId: int("employee_id"),
  notes: varchar("notes", { length: 255 }).notNull().default(""),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});

// legacy scaffold table kept for migration compat
export const entries = mysqlTable("entries", {
  id: int("id").primaryKey().autoincrement(),
  text: text("text").notNull(),
  createdAt: timestampMs("created_at").notNull().$defaultFn(() => new Date()),
});
