// Turns a pasted list or CSV file into seat rows and checks them. Columns are matched by
// header name: the person is the Email column (else Name), the tier is Seat or Seat Tier,
// Project and Status are optional. Claude's admin export ("Name","Email","Role","Status",
// "Seat Tier") imports as it is: the email identifies the person, Unassigned members and
// rows whose Status isn't Active are skipped. Without a header row the columns are read in
// the order person, seat, project (so "email, seat" pastes work). Pure functions.

import { parseCsv } from "./csv.ts";
import { nameKey } from "./seat-roster.ts";
import type { SeatTier } from "./subscription-seats.ts";

export type SeatCsvRow = { name: string; seat: string; project: string; status?: string };

const HEADERS: Record<keyof SeatCsvRow, string[]> = {
  name: ["name", "person", "user", "full name", "employee"],
  seat: ["seat", "seat tier", "tier", "seat type", "type", "plan"],
  project: ["project", "team", "department"],
  status: ["status"],
};
const EMAIL_HEADERS = ["email", "e-mail", "email address"];

export const SEAT_CSV_TEMPLATE =
  "Email,Seat,Project\r\nsara@example.com,Premium,Bidding\r\nomar@example.com,Standard,Operations\r\n";

const TIERS: Record<string, SeatTier> = {
  standard: "standard",
  std: "standard",
  premium: "premium",
  prem: "premium",
};

/** "Premium" / "std" gives the tier, or null for anything else. */
export function parseTier(value: string): SeatTier | null {
  return TIERS[value.trim().toLowerCase()] ?? null;
}

/** Spreadsheet pastes are tab separated; read them like commas. */
function normaliseSeparators(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  return firstLine.includes("\t") && !firstLine.includes(",") ? text.replace(/\t/g, ",") : text;
}

/** Reads the rows; an error message for an unusable input. */
export function parseSeatList(text: string): { rows: SeatCsvRow[] } | { error: string } {
  const table = parseCsv(normaliseSeparators(text));
  if (table.length === 0) return { error: "Nothing to import. Paste a list or choose a file." };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index = { name: -1, seat: -1, project: -1, status: -1 } as Record<keyof SeatCsvRow, number>;
  for (const key of Object.keys(HEADERS) as (keyof SeatCsvRow)[])
    index[key] = header.findIndex((h) => HEADERS[key].includes(h));
  // The email identifies the person when the file has one.
  const email = header.findIndex((h) => EMAIL_HEADERS.includes(h));
  if (email !== -1) index.name = email;
  const hasHeader = index.name !== -1;
  if (!hasHeader) {
    // No header row: the first row is data, in the order Name, Seat, Project.
    index.name = 0;
    index.seat = 1;
    index.project = 2;
  } else if (index.seat === -1)
    return { error: "The header row needs a Seat column (Standard or Premium)." };
  const at = (r: string[], key: keyof SeatCsvRow) =>
    index[key] === -1 ? "" : (r[index[key]] ?? "").trim();
  return {
    rows: (hasHeader ? table.slice(1) : table).map((r) => ({
      name: at(r, "name"),
      seat: at(r, "seat"),
      project: at(r, "project"),
      status: at(r, "status"),
    })),
  };
}

export type SeatImportRow = { name: string; tier: SeatTier; project: string | null };
export type SeatImportProblem = { row: number; message: string };
export const MAX_SEAT_IMPORT = 500;

/**
 * Checks every row: a name, a known seat type, no name repeated in the file, nobody who
 * already holds an active seat (`activeNames`, any case). `rows` holds the valid rows.
 */
export function checkSeatRows(
  input: SeatCsvRow[],
  activeNames: Iterable<string>,
): {
  rows: SeatImportRow[];
  problems: SeatImportProblem[];
  unassigned: number;
  inactive: number;
} {
  const none = { rows: [], unassigned: 0, inactive: 0 };
  if (input.length === 0) return { ...none, problems: [{ row: 0, message: "No rows to import." }] };
  if (input.length > MAX_SEAT_IMPORT)
    return {
      ...none,
      problems: [{ row: 0, message: `Import up to ${MAX_SEAT_IMPORT} seats at a time.` }],
    };
  const active = new Set([...activeNames].map(nameKey));
  const seen = new Map<string, number>();
  const rows: SeatImportRow[] = [];
  const problems: SeatImportProblem[] = [];
  let unassigned = 0;
  let inactive = 0;
  input.forEach((r, i) => {
    const row = i + 1;
    const name = r.name.trim();
    const status = (r.status ?? "").trim().toLowerCase();
    if (status && status !== "active") return void inactive++;
    if (r.seat.trim().toLowerCase() === "unassigned") return void unassigned++;
    if (!name) return void problems.push({ row, message: "Name is empty." });
    if (name.length > 200) return void problems.push({ row, message: "Name is too long." });
    const tier = parseTier(r.seat);
    if (!tier)
      return void problems.push({
        row,
        message: r.seat.trim()
          ? `${name}: unknown seat type “${r.seat.trim()}” (use Standard or Premium).`
          : `${name}: Seat is empty (use Standard or Premium).`,
      });
    const key = nameKey(name);
    if (seen.has(key))
      return void problems.push({ row, message: `${name} repeats row ${seen.get(key)}.` });
    seen.set(key, row);
    if (active.has(key))
      return void problems.push({ row, message: `${name} already holds an active seat.` });
    rows.push({ name, tier, project: r.project.trim() || null });
  });
  return { rows, problems, unassigned, inactive };
}

/** "17 unassigned members skipped · 2 not active skipped", or null when nothing was skipped. */
export function skippedNote(unassigned: number, inactive: number): string | null {
  const parts = [
    unassigned ? `${unassigned} unassigned member${unassigned === 1 ? "" : "s"} skipped` : null,
    inactive ? `${inactive} not active skipped` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
