// Seeds realistic Dubai sample data so every screen looks real.
//
//   pnpm db:seed --dry-run   inserts everything in a transaction, prints counts, rolls back
//                            (on a populated database it clears the app tables first, inside
//                            the same rolled-back transaction)
//   pnpm db:seed --yes       inserts for real and uploads placeholder PDFs to storage
//
// Never runs automatically (not part of build, deploy or migrate). Refuses to run if the
// database already contains data. The sample world is anchored on Tue 13 Oct 2026.

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import * as s from "../src/db/schema.ts";
import { toAed } from "../src/lib/config.ts";
import { parsePoNumber } from "../src/lib/ids.ts";
import { insertSampleChecklists } from "./sample-checklists.ts";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
if (!DRY_RUN && !args.has("--yes")) {
  console.error(
    "Usage: pnpm db:seed --dry-run | --yes\n  --yes writes sample data to DATABASE_URL.",
  );
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set (see .env.example).");
const ADMIN = (process.env.ALLOWED_EMAIL ?? "you@example.com").toLowerCase();

const client = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema: s, casing: "snake_case" });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Dubai wall-clock time → Date. */
const dxb = (date: string, time = "09:00") => new Date(`${date}T${time}:00+04:00`);

class Rollback extends Error {}

type PendingUpload = { path: string; fileName: string; title: string };
const uploads: PendingUpload[] = [];

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const VENDORS: { name: string; notes?: string }[] = [
  { name: "Jumbo Electronics", notes: "Apple and accessories. Business desk, Dubai." },
  { name: "Sharaf DG Business", notes: "Phones, tablets and peripherals." },
  { name: "Redington Gulf", notes: "Distributor: Dell, Ubiquiti, Microsoft licensing." },
  { name: "Mindware", notes: "Distributor: Lenovo, Google Workspace, Zoom." },
  { name: "Emitac", notes: "Storage and infrastructure (Synology)." },
  { name: "e& (Etisalat)", notes: "Business mobile lines." },
  { name: "du", notes: "Business internet and data SIMs." },
  { name: "Anthropic", notes: "Claude Team. Billed in USD." },
  { name: "OpenAI", notes: "ChatGPT Business. Billed in USD." },
  { name: "Atlassian", notes: "Jira Software Cloud. Billed in USD." },
  { name: "Adobe", notes: "Creative Cloud for Teams." },
  { name: "JetBrains", notes: "All Products Pack." },
  { name: "1Password", notes: "1Password Business." },
];

type PersonSeed = {
  key: string;
  fullName: string;
  department: string;
  managerName?: string;
  status?: "active" | "leaving" | "left";
  startDate?: string;
  endDate?: string;
};

const PEOPLE: PersonSeed[] = [
  {
    key: "karim",
    fullName: "Karim Saleh",
    department: "Design",
    managerName: "Hannah Brooks",
    status: "left",
    startDate: "2023-03-05",
    endDate: "2026-10-09",
  },
  {
    key: "priya",
    fullName: "Priya Nair",
    department: "Engineering",
    managerName: "Daniel Okafor",
    startDate: "2026-10-19",
  },
  {
    key: "aisha",
    fullName: "Aisha Rahman",
    department: "Product",
    managerName: "Ravi Menon",
    startDate: "2026-10-12",
  },
  {
    key: "omar",
    fullName: "Omar Haddad",
    department: "Engineering",
    managerName: "Daniel Okafor",
    startDate: "2024-02-11",
  },
  {
    key: "lina",
    fullName: "Lina Khoury",
    department: "Engineering",
    managerName: "Daniel Okafor",
    status: "left",
    startDate: "2025-01-16",
    endDate: "2026-04-30",
  },
  {
    key: "daniel",
    fullName: "Daniel Okafor",
    department: "Engineering",
    startDate: "2022-06-01",
  },
  {
    key: "hannah",
    fullName: "Hannah Brooks",
    department: "Design",
    startDate: "2022-09-12",
  },
  {
    key: "ravi",
    fullName: "Ravi Menon",
    department: "Product",
    startDate: "2023-01-08",
  },
  {
    key: "wei",
    fullName: "Wei Zhang",
    department: "Engineering",
    startDate: "2023-05-21",
  },
  {
    key: "sara",
    fullName: "Sara Mansour",
    department: "Sales",
    startDate: "2024-08-04",
  },
];

type LineSeed = {
  description: string;
  qty: number;
  unit: number;
};
type PoSeed = {
  poNumber: string;
  vendor: string;
  vendorCode: string;
  status: (typeof s.poStatus.enumValues)[number];
  requestedOn: string;
  notes?: string;
  lines: LineSeed[];
  docs: ("approval" | "invoice" | "delivery_note")[];
};

const POS: PoSeed[] = [
  {
    poNumber: "PO-2026-0158",
    vendor: "Sharaf DG Business",
    vendorCode: "SDG",
    status: "requested",
    requestedOn: "2026-10-11",
    lines: [{ description: "iPad Air 11″ M3, 128 GB Wi-Fi", qty: 2, unit: 2599 }],
    docs: [],
  },
  {
    poNumber: "PO-2026-0157",
    vendor: "Jumbo Electronics",
    vendorCode: "JE",
    status: "requested",
    requestedOn: "2026-10-07",
    lines: [{ description: "Logitech MX Keys S Combo", qty: 8, unit: 449 }],
    docs: [],
  },
  {
    poNumber: "PO-2026-0156",
    vendor: "Emitac",
    vendorCode: "EMT",
    status: "requested",
    requestedOn: "2026-10-05",
    notes: "Replaces the file server in DIC Bldg 9.",
    lines: [
      { description: "Synology DS923+ 4-bay NAS", qty: 1, unit: 2420 },
      { description: "Synology HAT5300 8 TB drive", qty: 4, unit: 1610 },
    ],
    docs: [],
  },
  {
    poNumber: "PO-2026-0155",
    vendor: "Mindware",
    vendorCode: "MW",
    status: "approved",
    requestedOn: "2026-10-02",
    lines: [
      {
        description: "Lenovo ThinkPad T14s Gen 6, 32 GB / 1 TB",
        qty: 3,
        unit: 5995,
      },
    ],
    docs: ["approval"],
  },
  {
    poNumber: "PO-2026-0153",
    vendor: "Sharaf DG Business",
    vendorCode: "SDG",
    status: "ordered",
    requestedOn: "2026-09-29",
    lines: [{ description: "iPhone 16, 128 GB, Black", qty: 4, unit: 3399 }],
    docs: ["approval"],
  },
  {
    poNumber: "PO-2026-0151",
    vendor: "Redington Gulf",
    vendorCode: "RG",
    status: "delivered",
    requestedOn: "2026-09-25",
    lines: [
      {
        description: "Dell P2725H 27″ IPS monitor",
        qty: 10,
        unit: 949,
      },
    ],
    docs: ["approval", "invoice"],
  },
  {
    poNumber: "PO-2026-0148",
    vendor: "Jumbo Electronics",
    vendorCode: "JE",
    status: "delivered",
    requestedOn: "2026-09-22",
    lines: [
      {
        description: "MacBook Pro 14″ M4 Pro, 24 GB / 1 TB, Space Black",
        qty: 6,
        unit: 8399,
      },
    ],
    docs: ["approval", "invoice", "delivery_note"],
  },
  {
    poNumber: "PO-2026-0144",
    vendor: "du",
    vendorCode: "DU",
    status: "closed",
    requestedOn: "2026-09-12",
    lines: [{ description: "Data SIM activation, 50 GB plan", qty: 5, unit: 125 }],
    docs: ["approval", "invoice", "delivery_note"],
  },
  {
    poNumber: "PO-2026-0139",
    vendor: "Redington Gulf",
    vendorCode: "RG",
    status: "closed",
    requestedOn: "2026-09-03",
    lines: [
      {
        description: "Ubiquiti U7 Pro access point",
        qty: 6,
        unit: 999,
      },
    ],
    docs: ["approval", "invoice", "delivery_note"],
  },
  {
    poNumber: "PO-2025-0012",
    vendor: "Jumbo Electronics",
    vendorCode: "JE",
    status: "closed",
    requestedOn: "2025-01-08",
    lines: [
      {
        description: "MacBook Pro 14″ M3 Pro, 18 GB / 512 GB",
        qty: 1,
        unit: 7999,
      },
    ],
    docs: ["approval", "invoice", "delivery_note"],
  },
];

type StockSeed = {
  tag: string;
  model: string;
  serial: string | null;
  specifications?: string;
  notes?: string;
  addedOn: string;
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** What's sitting in the IT store. */
const STOCK: StockSeed[] = [
  {
    tag: "DP-LT-0238",
    model: "MacBook Pro 14″ M4 Pro",
    specifications: "M4 Pro, 24 GB / 1 TB, Space Black",
    serial: "W3NB6RJ8PK",
    notes: "Set aside for Priya Nair (starts 19 Oct)",
    addedOn: "2026-10-01",
  },
  {
    tag: "DP-LT-0240",
    model: "MacBook Pro 14″ M4 Pro",
    specifications: "M4 Pro, 24 GB / 1 TB, Space Black",
    serial: null,
    addedOn: "2026-10-13",
  },
  {
    tag: "DP-LT-0241",
    model: "MacBook Pro 14″ M4 Pro",
    specifications: "M4 Pro, 24 GB / 1 TB, Space Black",
    serial: null,
    addedOn: "2026-10-13",
  },
  {
    tag: "DP-MN-0152",
    model: "Dell P2722H 27″",
    serial: "CN0F2M8K31152",
    notes: "Returned by Karim Saleh",
    addedOn: "2026-10-09",
  },
  ...range(87, 96).map((n): StockSeed => ({
    tag: `DP-MN-00${n}`,
    model: "Dell P2725H 27″",
    specifications: "27″ IPS, 100 Hz, USB-C",
    serial: `CN0D7H2K742${String(n - 36).padStart(2, "0")}`,
    addedOn: "2026-10-13",
  })),
  {
    tag: "DP-PH-0031",
    model: "Samsung Galaxy S24",
    specifications: "128 GB, Onyx Black",
    serial: "R5CX20KQ8LM",
    addedOn: "2025-02-11",
  },
  {
    tag: "DP-AC-0012",
    model: "Logitech MX Keys S Combo",
    serial: null,
    notes: "Shelf B2",
    addedOn: "2026-08-20",
  },
  {
    tag: "DP-AC-0013",
    model: "Logitech MX Keys S Combo",
    serial: null,
    notes: "Shelf B2",
    addedOn: "2026-08-20",
  },
];

type SubSeed = {
  key: string;
  name: string;
  vendor: string;
  kind?: "subscription" | "contract";
  plan: string;
  seats?: number;
  cycle: "monthly" | "yearly";
  cost: number;
  currency?: "AED" | "USD";
  paidBy: string;
  next: string;
  contractEnd?: string;
  autoRenew?: boolean;
  invoicePrefix: string;
  firstPeriod: string;
  missing?: string[];
  overrides?: Record<string, number>;
};

const SUBS: SubSeed[] = [
  {
    key: "claude-dp",
    name: "Claude Team",
    vendor: "Anthropic",
    plan: "Standard",
    seats: 20,
    cycle: "monthly",
    cost: 600,
    currency: "USD",
    paidBy: "Corporate card · Acme",
    next: "2026-10-19",
    invoicePrefix: "ANT",
    firstPeriod: "2026-05-19",
    missing: ["Sep 2026"],
    overrides: { "Jun 2026": 540, "Jul 2026": 540 },
  },
  {
    key: "claude-ct",
    name: "Claude Team — annual workspace",
    vendor: "Anthropic",
    plan: "Standard · annual",
    seats: 20,
    cycle: "yearly",
    cost: 7200,
    currency: "USD",
    paidBy: "Bank transfer · Acme",
    next: "2026-11-19",
    invoicePrefix: "ANT",
    firstPeriod: "2025-11-19",
  },
  {
    key: "chatgpt",
    name: "ChatGPT Business",
    vendor: "OpenAI",
    plan: "Business",
    seats: 6,
    cycle: "monthly",
    cost: 180,
    currency: "USD",
    paidBy: "Corporate card · Acme",
    next: "2026-11-03",
    invoicePrefix: "OAI",
    firstPeriod: "2026-05-03",
    missing: ["Sep 2026", "Aug 2026"],
  },
  {
    key: "m365",
    name: "Microsoft 365 Business Premium",
    vendor: "Redington Gulf",
    plan: "Business Premium",
    seats: 42,
    cycle: "yearly",
    cost: 31248,
    paidBy: "Bank transfer · Acme",
    next: "2026-10-24",
    invoicePrefix: "RG",
    firstPeriod: "2024-10-24",
  },
  {
    key: "gws",
    name: "Google Workspace Business Standard",
    vendor: "Mindware",
    plan: "Business Standard",
    seats: 12,
    cycle: "monthly",
    cost: 588,
    paidBy: "Corporate card · Acme",
    next: "2026-11-06",
    invoicePrefix: "MW",
    firstPeriod: "2026-05-06",
  },
  {
    key: "jira",
    name: "Jira Software Cloud",
    vendor: "Atlassian",
    plan: "Standard",
    seats: 35,
    cycle: "monthly",
    cost: 362.25,
    currency: "USD",
    paidBy: "Corporate card · Acme",
    next: "2026-11-02",
    invoicePrefix: "AT",
    firstPeriod: "2026-05-02",
  },
  {
    key: "zoom",
    name: "Zoom Workplace Pro",
    vendor: "Mindware",
    plan: "Pro",
    seats: 10,
    cycle: "yearly",
    cost: 6600,
    paidBy: "Bank transfer · Acme",
    next: "2026-10-18",
    invoicePrefix: "MW",
    firstPeriod: "2024-10-18",
  },
  {
    key: "adobe",
    name: "Adobe Creative Cloud for Teams",
    vendor: "Adobe",
    plan: "All Apps",
    seats: 4,
    cycle: "yearly",
    cost: 13104,
    paidBy: "Corporate card · Acme",
    next: "2026-10-28",
    invoicePrefix: "ADB",
    firstPeriod: "2024-10-28",
    missing: ["2025"],
  },
  {
    key: "jetbrains",
    name: "JetBrains All Products Pack",
    vendor: "JetBrains",
    plan: "All Products Pack",
    seats: 8,
    cycle: "yearly",
    cost: 22890,
    paidBy: "Bank transfer · Acme",
    next: "2026-11-30",
    autoRenew: false,
    invoicePrefix: "JB",
    firstPeriod: "2024-11-30",
  },
  {
    key: "1password",
    name: "1Password Business",
    vendor: "1Password",
    plan: "Business",
    seats: 40,
    cycle: "yearly",
    cost: 17630,
    paidBy: "Corporate card · Acme",
    next: "2027-01-09",
    invoicePrefix: "1P",
    firstPeriod: "2025-01-09",
  },
  {
    key: "eand",
    name: "e& Business Mobile",
    vendor: "e& (Etisalat)",
    kind: "contract",
    plan: "18 lines · 24-month contract",
    seats: 18,
    cycle: "monthly",
    cost: 2970,
    paidBy: "Direct debit · Acme",
    next: "2026-10-15",
    contractEnd: "2026-11-15",
    autoRenew: false,
    invoicePrefix: "EAND",
    firstPeriod: "2026-05-15",
    missing: ["Sep 2026"],
  },
  {
    key: "du",
    name: "du Business Internet 500 Mbps",
    vendor: "du",
    kind: "contract",
    plan: "36-month contract",
    cycle: "monthly",
    cost: 1299,
    paidBy: "Direct debit · Acme",
    next: "2026-11-01",
    contractEnd: "2026-12-31",
    autoRenew: false,
    invoicePrefix: "DU",
    firstPeriod: "2026-05-01",
  },
];

type ManualTaskSeed = {
  title: string;
  due: string;
  priority: 1 | 2 | 3;
  status?: "open" | "in_progress" | "waiting";
  source?: "manual" | "subscription";
  po?: string;
  sub?: string;
  createdAt: Date;
};

const MANUAL_TASKS: ManualTaskSeed[] = [
  {
    title: "Chase delivery note from Redington Gulf",
    due: "2026-10-08",
    priority: 2,
    status: "waiting",
    po: "PO-2026-0151",
    createdAt: dxb("2026-10-05"),
  },
  {
    title: "Get signed approval for NAS purchase",
    due: "2026-10-14",
    priority: 2,
    status: "waiting",
    po: "PO-2026-0156",
    createdAt: dxb("2026-10-05", "11:00"),
  },
  {
    title: "Confirm seat count before Microsoft 365 renewal",
    due: "2026-10-16",
    priority: 2,
    source: "subscription",
    sub: "m365",
    createdAt: dxb("2026-10-12", "11:02"),
  },
  {
    title: "Chase invoice from Sharaf DG for the iPhones",
    due: "2026-10-20",
    priority: 3,
    po: "PO-2026-0148",
    createdAt: dxb("2026-10-01", "15:00"),
  },
  {
    title: "Label and shelve 10 new Dell monitors",
    due: "2026-10-20",
    priority: 3,
    po: "PO-2026-0151",
    createdAt: dxb("2026-10-13", "10:20"),
  },
  {
    title: "Quarterly stock count — IT store",
    due: "2026-10-30",
    priority: 3,
    createdAt: dxb("2026-10-01", "09:00"),
  },
  {
    title: "Review e& line usage before contract end",
    due: "2026-11-05",
    priority: 2,
    source: "subscription",
    sub: "eand",
    createdAt: dxb("2026-10-08", "09:30"),
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

const periodLabel = (cycle: "monthly" | "yearly", date: string) =>
  cycle === "yearly"
    ? date.slice(0, 4)
    : `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

function need<T>(map: Map<string, T>, key: string | undefined, what: string): T {
  const value = key === undefined ? undefined : map.get(key);
  if (value === undefined) throw new Error(`Unknown ${what}: ${key}`);
  return value;
}

/** A small, valid one-page PDF used as a stand-in for real paperwork. */
function placeholderPdf(title: string): Uint8Array {
  const text = title.replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "-");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj 0 -28 Td /F1 11 Tf (Sample document - IT Ops seed data) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed(tx: Tx) {
  // Curated history is written explicitly below, so skip the per-row trigger here.
  await tx.execute(sql`select set_config('app.skip_activity_log', 'on', true)`);

  const vendorRows = await tx.insert(s.vendors).values(VENDORS).returning();
  const vendorId = new Map(vendorRows.map((v) => [v.name, v.id]));

  const personRows = await tx
    .insert(s.people)
    .values(
      PEOPLE.map((p) => ({
        fullName: p.fullName,
        department: p.department,
        managerName: p.managerName,
        status: p.status ?? "active",
        startDate: p.startDate,
        endDate: p.endDate,
      })),
    )
    .returning();
  const personId = new Map(PEOPLE.map((p, i) => [p.key, personRows[i]!.id]));

  // Purchase orders, lines and their paperwork.
  const poId = new Map<string, string>();
  const docCount = { n: 0 };
  for (const po of POS) {
    const [row] = await tx
      .insert(s.purchaseOrders)
      .values({
        poNumber: po.poNumber,
        vendorId: need(vendorId, po.vendor, "vendor"),
        status: po.status,
        requestedOn: po.requestedOn,
        notes: po.notes,
        createdAt: dxb(po.requestedOn, "10:00"),
      })
      .returning();
    poId.set(po.poNumber, row!.id);
    await tx.insert(s.poLines).values(
      po.lines.map((l) => ({
        poId: row!.id,
        description: l.description,
        qty: l.qty,
        unitPriceAed: l.unit,
      })),
    );
    for (const kind of po.docs) {
      const prefix = { approval: "APR", invoice: "INV", delivery_note: "DN" }[kind];
      const fileName = `${prefix}-${po.vendorCode}-${po.poNumber.slice(-4)}.pdf`;
      const storagePath = `purchase-orders/${row!.id}/${kind}-${fileName}`;
      const title = `${po.poNumber} - ${kind.replace("_", " ")}`;
      await tx.insert(s.documents).values({
        ownerType: "purchase_order",
        ownerId: row!.id,
        kind,
        storagePath,
        fileName,
        sizeBytes: placeholderPdf(title).byteLength,
        uploadedAt: dxb(po.requestedOn, "16:00"),
      });
      uploads.push({ path: storagePath, fileName, title });
      docCount.n++;
    }
  }

  // Stock list (not logged: stock has no activity-log trigger).
  await tx.insert(s.stockItems).values(
    STOCK.map((x) => ({
      tag: x.tag,
      model: x.model,
      serialNumber: x.serial,
      specifications: x.specifications,
      notes: x.notes,
      createdAt: dxb(x.addedOn, "11:00"),
    })),
  );

  // Subscriptions and their invoice ledgers.
  const subId = new Map<string, string>();
  const subName = new Map<string, string>();
  let invoiceCount = 0;
  for (const sub of SUBS) {
    const currency = sub.currency ?? "AED";
    const [row] = await tx
      .insert(s.subscriptions)
      .values({
        name: sub.name,
        vendorId: need(vendorId, sub.vendor, "vendor"),
        kind: sub.kind ?? "subscription",
        plan: sub.plan,
        seats: sub.seats,
        billingCycle: sub.cycle,
        billingDay: Number(sub.next.slice(8, 10)),
        costOriginal: sub.cost,
        currency,
        costAed: toAed(sub.cost, currency),
        paidBy: sub.paidBy,
        nextChargeDate: sub.next,
        renewalDate: sub.cycle === "yearly" ? sub.next : null,
        contractEndDate: sub.contractEnd,
        autoRenew: sub.autoRenew ?? true,
      })
      .returning();
    subId.set(sub.key, row!.id);
    subName.set(sub.key, sub.name);

    const step = sub.cycle === "yearly" ? 12 : 1;
    for (let period = sub.firstPeriod; period <= sub.next; period = addMonths(period, step)) {
      const label = periodLabel(sub.cycle, period);
      const upcoming = period === sub.next;
      const missing = !upcoming && (sub.missing ?? []).includes(label);
      const amount = sub.overrides?.[label] ?? sub.cost;
      const invoiceNumber = upcoming
        ? null
        : `${sub.invoicePrefix}-${period.slice(2, 4)}${sub.cycle === "monthly" ? period.slice(5, 7) : ""}-${String(1000 + ((invoiceCount * 37) % 9000)).padStart(4, "0")}`;

      let documentId: string | null = null;
      const [inv] = await tx
        .insert(s.subscriptionInvoices)
        .values({
          subscriptionId: row!.id,
          periodStart: period,
          periodLabel: label,
          invoiceNumber: missing ? null : invoiceNumber,
          amountOriginal: amount,
          amountAed: toAed(amount, currency),
          status: upcoming ? "upcoming" : missing ? "missing" : "on_file",
        })
        .returning();
      if (!upcoming && !missing) {
        const fileName = `${invoiceNumber}.pdf`;
        const storagePath = `subscription-invoices/${inv!.id}/${fileName}`;
        const title = `${sub.name} - ${label} invoice`;
        const [doc] = await tx
          .insert(s.documents)
          .values({
            ownerType: "subscription_invoice",
            ownerId: inv!.id,
            kind: "invoice",
            storagePath,
            fileName,
            sizeBytes: placeholderPdf(title).byteLength,
            uploadedAt: dxb(period, "12:00"),
          })
          .returning();
        documentId = doc!.id;
        await tx
          .update(s.subscriptionInvoices)
          .set({ documentId })
          .where(sql`${s.subscriptionInvoices.id} = ${inv!.id}`);
        uploads.push({ path: storagePath, fileName, title });
        docCount.n++;
      }
      invoiceCount++;
    }
  }

  // Checklists (equipment with sub-items + accounts) and their linked tasks.
  const sampleCounts = await insertSampleChecklists(
    tx,
    new Map(PEOPLE.map((p) => [p.key, { id: need(personId, p.key, "person"), name: p.fullName }])),
  );
  const itemCount = sampleCounts.items;
  let taskCount = sampleCounts.tasks;

  await tx.insert(s.tasks).values(
    MANUAL_TASKS.map((t) => ({
      title: t.title,
      dueDate: t.due,
      priority: t.priority,
      status: t.status ?? "open",
      source: t.source ?? "manual",
      poId: t.po ? need(poId, t.po, "PO") : null,
      subscriptionId: t.sub ? need(subId, t.sub, "subscription") : null,
      createdAt: t.createdAt,
    })),
  );
  taskCount += MANUAL_TASKS.length;

  // Curated activity history (mirrors design/Activity.html).
  type LogSeed = {
    at: Date;
    actor: string;
    action: "insert" | "update" | "delete";
    table: string;
    id: string;
    label: string;
    module: string;
    changes: s.ActivityChanges;
  };
  const item = async (label: string, person: string) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select ci.id from checklist_items ci
      join checklists c on c.id = ci.checklist_id
      where ci.label = ${label} and c.person_id = ${need(personId, person, "person")}`);
    return rows[0]!.id;
  };
  const ch = (field: string, from: unknown, to: unknown) => ({ [field]: { old: from, new: to } });
  const firstDocId = async (fileName: string) =>
    (
      await tx.execute<{ id: string }>(sql`select id from documents where file_name = ${fileName}`)
    )[0]!.id;
  const jiraSep = (
    await tx.execute<{ id: string }>(sql`
      select id from subscription_invoices
      where subscription_id = ${need(subId, "jira", "subscription")} and period_label = 'Sep 2026'`)
  )[0]!.id;

  const log: LogSeed[] = [
    {
      at: dxb("2026-10-09", "16:44"),
      actor: ADMIN,
      action: "insert",
      table: "documents",
      id: await firstDocId("APR-SDG-0153.pdf"),
      label: "APR-SDG-0153.pdf",
      module: "Procurement",
      changes: { ...ch("kind", null, "approval"), ...ch("file_name", null, "APR-SDG-0153.pdf") },
    },
    {
      at: dxb("2026-10-09", "16:44"),
      actor: ADMIN,
      action: "update",
      table: "purchase_orders",
      id: need(poId, "PO-2026-0153", "PO"),
      label: "PO-2026-0153",
      module: "Procurement",
      changes: ch("status", "requested", "approved"),
    },
    {
      at: dxb("2026-10-09", "18:10"),
      actor: ADMIN,
      action: "insert",
      table: "checklists",
      id: (
        await tx.execute<{ id: string }>(
          sql`select id from checklists where person_id = ${need(personId, "karim", "person")}`,
        )
      )[0]!.id,
      label: "Karim Saleh · offboarding",
      module: "People",
      changes: { ...ch("kind", null, "offboarding"), ...ch("target_date", null, "2026-10-09") },
    },
    {
      at: dxb("2026-10-11", "14:02"),
      actor: ADMIN,
      action: "insert",
      table: "purchase_orders",
      id: need(poId, "PO-2026-0158", "PO"),
      label: "PO-2026-0158",
      module: "Procurement",
      changes: { ...ch("po_number", null, "PO-2026-0158"), ...ch("status", null, "requested") },
    },
    {
      at: dxb("2026-10-12", "09:12"),
      actor: ADMIN,
      action: "insert",
      table: "checklists",
      id: (
        await tx.execute<{ id: string }>(
          sql`select id from checklists where person_id = ${need(personId, "priya", "person")}`,
        )
      )[0]!.id,
      label: "Priya Nair · onboarding",
      module: "People",
      changes: { ...ch("kind", null, "onboarding"), ...ch("target_date", null, "2026-10-19") },
    },
    {
      at: dxb("2026-10-12", "11:02"),
      actor: ADMIN,
      action: "insert",
      table: "tasks",
      id: (
        await tx.execute<{ id: string }>(
          sql`select id from tasks where title = 'Confirm seat count before Microsoft 365 renewal'`,
        )
      )[0]!.id,
      label: "Confirm seat count before Microsoft 365 renewal",
      module: "Tasks",
      changes: { ...ch("due_date", null, "2026-10-16"), ...ch("priority", null, 2) },
    },
    {
      at: dxb("2026-10-12", "11:30"),
      actor: ADMIN,
      action: "update",
      table: "subscriptions",
      id: need(subId, "m365", "subscription"),
      label: "Microsoft 365 Business Premium",
      module: "Subscriptions",
      changes: ch("seats", 40, 42),
    },
    {
      at: dxb("2026-10-12", "17:20"),
      actor: ADMIN,
      action: "update",
      table: "checklist_items",
      id: await item("Deactivate Jira account", "karim"),
      label: "Deactivate Jira account",
      module: "People",
      changes: ch("done_at", null, dxb("2026-10-12", "17:20").toISOString()),
    },
    {
      at: dxb("2026-10-13", "08:30"),
      actor: ADMIN,
      action: "update",
      table: "subscription_invoices",
      id: jiraSep,
      label: "Jira Software Cloud · Sep 2026",
      module: "Subscriptions",
      changes: ch("status", "missing", "on_file"),
    },
    {
      at: dxb("2026-10-13", "09:58"),
      actor: ADMIN,
      action: "insert",
      table: "documents",
      id: await firstDocId("APR-MW-0155.pdf"),
      label: "APR-MW-0155.pdf",
      module: "Procurement",
      changes: { ...ch("kind", null, "approval"), ...ch("file_name", null, "APR-MW-0155.pdf") },
    },
    {
      at: dxb("2026-10-13", "09:58"),
      actor: ADMIN,
      action: "update",
      table: "purchase_orders",
      id: need(poId, "PO-2026-0155", "PO"),
      label: "PO-2026-0155",
      module: "Procurement",
      changes: ch("status", "requested", "approved"),
    },
    {
      at: dxb("2026-10-13", "10:15"),
      actor: ADMIN,
      action: "update",
      table: "purchase_orders",
      id: need(poId, "PO-2026-0151", "PO"),
      label: "PO-2026-0151",
      module: "Procurement",
      changes: ch("status", "ordered", "delivered"),
    },
    {
      at: dxb("2026-10-13", "10:41"),
      actor: ADMIN,
      action: "update",
      table: "checklist_items",
      id: await item("MacBook Pro 14″ M4 Pro", "aisha"),
      label: "MacBook Pro 14″ M4 Pro",
      module: "People",
      changes: ch("done_at", null, dxb("2026-10-13", "10:41").toISOString()),
    },
  ];
  await tx.insert(s.activityLog).values(
    log.map((l) => ({
      at: l.at,
      actor: l.actor,
      action: l.action,
      tableName: l.table,
      recordId: l.id,
      recordLabel: l.label,
      module: l.module,
      changes: l.changes,
    })),
  );

  // Counters: continue PO numbering after the highest seeded PO number per year.
  const highest = new Map<string, number>();
  for (const id of POS.map((p) => p.poNumber)) {
    const parsed = parsePoNumber(id);
    if (!parsed) throw new Error(`Unparseable identifier ${id}`);
    highest.set(parsed.scope, Math.max(highest.get(parsed.scope) ?? 0, parsed.seq));
  }
  await tx
    .insert(s.idCounters)
    .values([...highest].map(([scope, lastValue]) => ({ scope, lastValue })));

  return {
    vendors: vendorRows.length,
    people: personRows.length,
    purchaseOrders: POS.length,
    stockItems: STOCK.length,
    subscriptions: SUBS.length,
    subscriptionInvoices: invoiceCount,
    documents: docCount.n,
    checklists: sampleCounts.checklists,
    checklistItems: itemCount,
    tasks: taskCount,
    activityLog: log.length,
    counters: highest.size,
  };
}

async function uploadPlaceholders() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn("Skipping file uploads: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY not set.");
    return;
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let done = 0;
  for (const u of uploads) {
    const body = placeholderPdf(u.title);
    const { error } = await supabase.storage
      .from("documents")
      .upload(u.path, body, { contentType: "application/pdf", upsert: true });
    if (error) throw new Error(`Upload failed for ${u.path}: ${error.message}`);
    done++;
  }
  console.log(`Uploaded ${done} placeholder PDFs to the documents bucket.`);
}

try {
  const [existing] = await client<{ n: number }[]>`select count(*)::int as n from vendors`;
  const n = existing?.n ?? 0;
  if (n > 0 && !DRY_RUN) {
    console.error("The database already has data. The seed only runs on an empty database.");
    process.exitCode = 1;
  } else {
    let counts: Awaited<ReturnType<typeof seed>> | undefined;
    await db
      .transaction(async (tx) => {
        if (n > 0) {
          // Dry run on a populated database: clear app tables inside this transaction so
          // the seed can be checked end to end. Everything is rolled back afterwards.
          // (activity_log is append-only and is left as it is.)
          await tx.execute(sql`
            truncate tasks, checklist_items, checklists, subscription_invoices, subscriptions,
              stock_items, documents, po_lines, purchase_orders, people, vendors, id_counters`);
        }
        counts = await seed(tx);
        if (DRY_RUN) throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    console.table(counts);
    if (DRY_RUN) {
      console.log("Dry run: everything above was inserted and then rolled back.");
    } else {
      await uploadPlaceholders();
      console.log("Seed complete.");
    }
  }
} finally {
  await client.end();
}
