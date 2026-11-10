import { relations, sql } from "drizzle-orm";
import type { ChecklistLine, NoteColour } from "../lib/board.ts";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  pgView,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Column names are snake_case in Postgres; `casing: "snake_case"` maps them from camelCase keys.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const personStatus = pgEnum("person_status", ["active", "leaving", "left"]);
export const poStatus = pgEnum("po_status", [
  "requested",
  "approved",
  "ordered",
  "delivered",
  "closed",
]);
export const docOwnerType = pgEnum("doc_owner_type", [
  "purchase_order",
  "subscription_invoice",
  "note",
]);
export const docKind = pgEnum("doc_kind", ["invoice", "delivery_note", "approval", "other"]);
export const invoiceKind = pgEnum("invoice_kind", ["renewal", "prorated"]);
export const subKind = pgEnum("sub_kind", ["subscription", "contract"]);
export const billingCycle = pgEnum("billing_cycle", ["monthly", "yearly"]);
export const invoiceStatus = pgEnum("invoice_status", ["upcoming", "missing", "on_file"]);
export const taskStatus = pgEnum("task_status", ["open", "in_progress", "waiting", "done"]);
export const taskSource = pgEnum("task_source", ["manual", "checklist", "subscription", "system"]);
export const checklistKind = pgEnum("checklist_kind", ["onboarding", "offboarding"]);
export const checklistStatus = pgEnum("checklist_status", ["open", "completed", "cancelled"]);
export const checklistSection = pgEnum("checklist_section", [
  "accounts",
  "assets",
  "licences",
  "sim",
]);
export const stockStatus = pgEnum("stock_status", ["in_stock", "deployed", "retired"]);
export const logAction = pgEnum("log_action", ["insert", "update", "delete"]);

// ---------------------------------------------------------------------------
// Shared columns
// ---------------------------------------------------------------------------

const id = () => uuid().primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};
const aed = () => numeric({ precision: 12, scale: 2, mode: "number" });
const day = () => date({ mode: "string" });

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const vendors = pgTable("vendors", {
  id: id(),
  name: text().notNull().unique(),
  contactName: text(),
  email: text(),
  phone: text(),
  notes: text(),
  ...timestamps,
});

export const people = pgTable(
  "people",
  {
    id: id(),
    fullName: text().notNull(),
    email: text().unique(),
    department: text(),
    managerName: text(),
    status: personStatus().notNull().default("active"),
    startDate: day(),
    endDate: day(),
    ...timestamps,
  },
  (t) => [index().on(t.status)],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: id(),
    poNumber: text().notNull().unique(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id),
    status: poStatus().notNull().default("requested"),
    requestedOn: day().notNull(),
    notes: text(),
    /** Optional: leads the invoice file name. */
    invoiceNumber: text(),
    /** Optional: part of every document file name. */
    project: text(),
    /** 5% VAT applies to the subtotal after the discount. */
    vatApplied: boolean().notNull().default(false),
    /** Discount in the base currency, taken off the line subtotal before VAT. */
    discountAed: aed().notNull().default(0),
    /** Optional: the date on the supplier's invoice; leads the invoice file name's date. */
    invoiceDate: day(),
    ...timestamps,
  },
  (t) => [
    check("purchase_orders_po_number_format", sql`${t.poNumber} ~ '^PO-[0-9]{4}-[0-9]{4}$'`),
    check("purchase_orders_discount_nonneg", sql`${t.discountAed} >= 0`),
    index().on(t.status),
  ],
);

export const poLines = pgTable(
  "po_lines",
  {
    id: id(),
    poId: uuid()
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    description: text().notNull(),
    qty: integer().notNull(),
    unitPriceAed: aed().notNull(),
    ...timestamps,
  },
  (t) => [check("po_lines_qty_positive", sql`${t.qty} > 0`), index().on(t.poId)],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    // Polymorphic owner: a purchase order or a subscription invoice (no FK).
    ownerType: docOwnerType().notNull(),
    ownerId: uuid().notNull(),
    kind: docKind().notNull(),
    storagePath: text().notNull().unique(),
    /** The name shown in the app and used for downloads (`Vendor_Type_Date.ext` for new uploads). */
    fileName: text().notNull(),
    /** The file name as it was uploaded; null for documents attached before renaming. */
    originalName: text(),
    sizeBytes: bigint({ mode: "number" }).notNull(),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index().on(t.ownerType, t.ownerId)],
);

/**
 * Stock list: individual units in the IT store. Added by hand. Checking a unit out keeps
 * the row (status "deployed", who has it and since when); checking it in returns it to
 * "in_stock"; "retired" units are kept for the record. Stock changes are deliberately
 * not written to the activity log (no trigger on this table).
 */
export const stockItems = pgTable("stock_items", {
  id: id(),
  /** Entered by hand (e.g. the label on the box or the asset system's tag). */
  tag: text().notNull().unique(),
  model: text().notNull(),
  serialNumber: text(),
  specifications: text(),
  notes: text(),
  status: stockStatus().notNull().default("in_stock"),
  /** Who has the unit while deployed (free text, matched to a person when possible). */
  issuedToName: text(),
  assignedPersonId: uuid().references(() => people.id, { onDelete: "set null" }),
  issuedOn: day(),
  /** Note from the last check-out. */
  issueNote: text(),
  ...timestamps,
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    name: text().notNull(),
    vendorId: uuid()
      .notNull()
      .references(() => vendors.id),
    kind: subKind().notNull().default("subscription"),
    plan: text(),
    seats: integer(),
    /** Seat tiers for tiered subscriptions; seats = standard + premium. Null otherwise. */
    seatsStandard: integer("seats_standard"),
    seatsPremium: integer("seats_premium"),
    /** Sold in Standard and Premium seats (the tiered-seats switch): shows the seat roster. */
    tieredSeats: boolean("tiered_seats").notNull().default(false),
    billingCycle: billingCycle().notNull(),
    billingDay: smallint(),
    /** Expected cost per period for fixed contracts; null when the bill varies. */
    costOriginal: aed(),
    currency: text().notNull().default("AED"),
    costAed: aed(),
    paidBy: text(),
    // Who a per-user plan is for (e.g. a Claude or ChatGPT seat), and its project.
    userName: text("assigned_to"),
    project: text(),
    nextChargeDate: day(),
    renewalDate: day(),
    contractEndDate: day(),
    /** Unused since the Cancel-by logic was removed; the column stays so older code keeps working. */
    noticeDays: integer("notice_days"),
    autoRenew: boolean().notNull().default(true),
    active: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("subscriptions_billing_day_range", sql`${t.billingDay} between 1 and 31`),
    check(
      "subscriptions_notice_days_range",
      sql`${t.noticeDays} is null or ${t.noticeDays} between 0 and 3650`,
    ),
    check(
      "subscriptions_seat_tiers_range",
      sql`(${t.seatsStandard} is null or ${t.seatsStandard} >= 0) and (${t.seatsPremium} is null or ${t.seatsPremium} >= 0)`,
    ),
    check("subscriptions_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    index().on(t.nextChargeDate),
  ],
);

export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    id: id(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    /** "renewal" = the regular billing period; "prorated" = an extra charge (e.g. a new seat). */
    kind: invoiceKind().notNull().default("renewal"),
    periodStart: day().notNull(),
    periodLabel: text().notNull(),
    /** Pro-rated rows only: who or what the charge is for. */
    userName: text(),
    project: text(),
    invoiceNumber: text(),
    /** Null for a period that has no expected cost and no invoice yet. */
    amountOriginal: aed(),
    amountAed: aed(),
    /** Renewal invoices of tiered subscriptions: the seat counts billed. */
    seatsStandard: integer("seats_standard"),
    seatsPremium: integer("seats_premium"),
    status: invoiceStatus().notNull().default("upcoming"),
    documentId: uuid().references(() => documents.id, { onDelete: "set null" }),
    /**
     * Set when a period was removed from the ledger. The row stays so the unique index below
     * stops ensureInvoicePeriods() creating it again; removed rows are hidden and not counted.
     */
    removedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One renewal row per date makes ensureInvoicePeriods() idempotent. Pro-rated rows are
    // extra charges and may share a date with each other and with a renewal.
    uniqueIndex("subscription_invoices_renewal_period_unique")
      .on(t.subscriptionId, t.periodStart)
      .where(sql`${t.kind} = 'renewal'`),
    index().on(t.status),
    check(
      "subscription_invoices_seat_counts_range",
      sql`(${t.seatsStandard} is null or ${t.seatsStandard} >= 0) and (${t.seatsPremium} is null or ${t.seatsPremium} >= 0)`,
    ),
  ],
);

/** One seat added by a pro-rated invoice: who it is for, its tier and optional project. */
export const proratedSeats = pgTable(
  "prorated_seats",
  {
    id: id(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => subscriptionInvoices.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    tier: text().notNull(),
    project: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.invoiceId),
    check("prorated_seats_tier", sql`${t.tier} in ('standard', 'premium')`),
  ],
);

/**
 * The seat roster of a tiered subscription : who holds
 * which seat. `until` null = active; ended seats stay as history.
 */
export const seatAssignments = pgTable(
  "seat_assignments",
  {
    id: id(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    personName: text("person_name").notNull(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    tier: text().notNull(),
    project: text(),
    since: day().notNull(),
    until: day(),
    /** "manual" | "prorated" | "import". */
    source: text().notNull().default("manual"),
    sourceInvoiceId: uuid("source_invoice_id").references(() => subscriptionInvoices.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    index().on(t.subscriptionId),
    index().on(t.personId),
    // One active seat per person on a subscription.
    uniqueIndex("seat_assignments_one_active")
      .on(t.subscriptionId, sql`lower(${t.personName})`)
      .where(sql`${t.until} is null`),
    check("seat_assignments_tier", sql`${t.tier} in ('standard', 'premium')`),
    check("seat_assignments_source", sql`${t.source} in ('manual', 'prorated', 'import')`),
  ],
);

export const checklists = pgTable(
  "checklists",
  {
    id: id(),
    personId: uuid()
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: checklistKind().notNull(),
    targetDate: day().notNull(),
    status: checklistStatus().notNull().default("open"),
    ...timestamps,
  },
  (t) => [index().on(t.personId), index().on(t.status)],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    checklistId: uuid()
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    /** Sub-items, e.g. each piece of equipment under "Collect equipment". */
    parentId: uuid().references((): AnyPgColumn => checklistItems.id, { onDelete: "cascade" }),
    section: checklistSection().notNull(),
    sort: integer().notNull().default(0),
    label: text().notNull(),
    detail: text(),
    subscriptionId: uuid().references(() => subscriptions.id, { onDelete: "set null" }),
    /** Offboarding: the seat this item removes; ticking it ends the seat. */
    seatAssignmentId: uuid("seat_assignment_id").references(() => seatAssignments.id, {
      onDelete: "set null",
    }),
    dueDate: day(),
    doneAt: timestamp({ withTimezone: true }),
    notApplicable: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index().on(t.checklistId, t.section, t.sort), index().on(t.parentId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text().notNull(),
    dueDate: day(),
    priority: smallint().notNull().default(2),
    status: taskStatus().notNull().default("open"),
    doneAt: timestamp({ withTimezone: true }),
    source: taskSource().notNull().default("manual"),
    checklistItemId: uuid()
      .unique()
      .references(() => checklistItems.id, { onDelete: "cascade" }),
    personId: uuid().references(() => people.id, { onDelete: "set null" }),
    poId: uuid().references(() => purchaseOrders.id, { onDelete: "set null" }),
    subscriptionId: uuid().references(() => subscriptions.id, { onDelete: "set null" }),
    /** Free-text notes on the task. */
    notes: text().notNull().default(""),
    ...timestamps,
  },
  (t) => [
    check("tasks_notes_length", sql`char_length(${t.notes}) <= 5000`),
    check("tasks_priority_range", sql`${t.priority} between 1 and 3`),
    check("tasks_done_at_matches_status", sql`(${t.status} = 'done') = (${t.doneAt} is not null)`),
    index().on(t.status, t.dueDate),
  ],
);

/**
 * Board: sticky notes on one corkboard. Position and size (x, y, width, height, z_index)
 * are saved as a note is moved and are not written to the activity log; everything else
 * is. A deleted note is hidden (deleted_at) for a short while so Undo works, then removed.
 * Attached files are `documents` rows with owner_type "note".
 */
export const notes = pgTable(
  "notes",
  {
    id: id(),
    text: text().notNull().default(""),
    colour: text().$type<NoteColour>().notNull().default("yellow"),
    x: integer().notNull().default(24),
    y: integer().notNull().default(24),
    width: integer().notNull().default(240),
    height: integer().notNull().default(220),
    zIndex: integer().notNull().default(1),
    checklist: jsonb()
      .$type<ChecklistLine[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // At most one linked record.
    personId: uuid().references(() => people.id, { onDelete: "set null" }),
    poId: uuid().references(() => purchaseOrders.id, { onDelete: "set null" }),
    subscriptionId: uuid().references(() => subscriptions.id, { onDelete: "set null" }),
    taskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    /** The task made from this note ("Make task"). */
    madeTaskId: uuid().references(() => tasks.id, { onDelete: "set null" }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check("notes_colour", sql`${t.colour} in ('yellow', 'pink', 'blue', 'green', 'orange')`),
    check("notes_size", sql`${t.width} between 120 and 1200 and ${t.height} between 80 and 1600`),
    check("notes_position", sql`${t.x} between 0 and 20000 and ${t.y} between 0 and 20000`),
    check("notes_z_index", sql`${t.zIndex} between 0 and 1000000`),
    check("notes_text_length", sql`char_length(${t.text}) <= 10000`),
    index().on(t.deletedAt),
  ],
);

export type ActivityChanges = Record<string, { old: unknown; new: unknown }>;

/** Append-only. Written only by the `log_activity()` trigger (see migration 0001). */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actor: text().notNull(),
    action: logAction().notNull(),
    tableName: text().notNull(),
    recordId: uuid().notNull(),
    recordLabel: text(),
    module: text().notNull(),
    changes: jsonb().$type<ActivityChanges>().notNull().default({}),
  },
  (t) => [
    index("activity_log_at_idx").on(t.at.desc()),
    index().on(t.module, t.at),
    index().on(t.recordId),
  ],
);

/** Sequence counters for PO numbers (`PO-2026`) and asset tags (`DP-LT`). */
export const idCounters = pgTable("id_counters", {
  scope: text().primaryKey(),
  lastValue: integer().notNull().default(0),
  ...timestamps,
});

/**
 * Per-alert state for the notifications bell. The alerts themselves are derived from live
 * data on every request; only whether one was read or dismissed is stored. The key encodes
 * the record and the threshold crossed, so a worse stage of the same record is a new alert.
 */
export const alertStates = pgTable(
  "alert_states",
  {
    alertKey: text().primaryKey(),
    state: text().$type<"read" | "dismissed">().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("alert_states_state", sql`${t.state} in ('read', 'dismissed')`)],
);

/** Workspace settings: a single row (id = 1). */
export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    id: smallint().primaryKey().default(1),
    workspaceName: text().notNull().default("IT Ops"),
    /** AED per 1 USD, applied to USD charges entered from now on (stored AED totals never change). */
    usdAedRate: numeric({ precision: 10, scale: 4, mode: "number" }).notNull().default(3.6725),
    /** ISO 4217 code of the base currency; the `aed` money columns hold amounts in it. */
    baseCurrency: text().notNull().default("AED"),
    /** IANA time zone every business date is calculated in. */
    timeZone: text().notNull().default("Asia/Dubai"),
    /** Storage path (documents bucket) of the custom logo; null = the default mark. */
    logoPath: text(),
    ...timestamps,
  },
  (t) => [
    check("workspace_settings_single", sql`${t.id} = 1`),
    check("workspace_settings_currency", sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`),
    check("workspace_settings_rate", sql`${t.usdAedRate} > 0`),
  ],
);

/**
 * The starting steps of new on/offboarding checklists, one row per kind. `steps` is an ordered
 * array of `{ label, detail? }` (the account steps; the equipment step is built in).
 */
export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: id(),
    kind: text().$type<"onboarding" | "offboarding">().notNull().unique(),
    steps: jsonb()
      .$type<{ label: string; detail?: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestamps,
  },
  (t) => [check("checklist_templates_kind", sql`${t.kind} in ('onboarding', 'offboarding')`)],
);

// ---------------------------------------------------------------------------
// Views (defined in SQL in migration 0001)
// ---------------------------------------------------------------------------

export const poTotals = pgView("po_totals", {
  poId: uuid().notNull(),
  totalAed: aed().notNull(),
  lineCount: integer().notNull(),
  unitCount: integer().notNull(),
}).existing();

// ---------------------------------------------------------------------------
// Relations (for db.query.*)
// ---------------------------------------------------------------------------

export const vendorsRelations = relations(vendors, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  subscriptions: many(subscriptions),
}));

export const peopleRelations = relations(people, ({ many }) => ({
  checklists: many(checklists),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  vendor: one(vendors, { fields: [purchaseOrders.vendorId], references: [vendors.id] }),
  lines: many(poLines),
}));

export const poLinesRelations = relations(poLines, ({ one }) => ({
  po: one(purchaseOrders, { fields: [poLines.poId], references: [purchaseOrders.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  vendor: one(vendors, { fields: [subscriptions.vendorId], references: [vendors.id] }),
  invoices: many(subscriptionInvoices),
}));

export const subscriptionInvoicesRelations = relations(subscriptionInvoices, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [subscriptionInvoices.subscriptionId],
    references: [subscriptions.id],
  }),
  document: one(documents, {
    fields: [subscriptionInvoices.documentId],
    references: [documents.id],
  }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
  person: one(people, { fields: [checklists.personId], references: [people.id] }),
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(checklists, {
    fields: [checklistItems.checklistId],
    references: [checklists.id],
  }),
  subscription: one(subscriptions, {
    fields: [checklistItems.subscriptionId],
    references: [subscriptions.id],
  }),
  task: one(tasks, { fields: [checklistItems.id], references: [tasks.checklistItemId] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  checklistItem: one(checklistItems, {
    fields: [tasks.checklistItemId],
    references: [checklistItems.id],
  }),
  person: one(people, { fields: [tasks.personId], references: [people.id] }),
  po: one(purchaseOrders, { fields: [tasks.poId], references: [purchaseOrders.id] }),
  subscription: one(subscriptions, {
    fields: [tasks.subscriptionId],
    references: [subscriptions.id],
  }),
}));
