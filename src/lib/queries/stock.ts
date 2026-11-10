import "server-only";
import { asc, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { people, stockItems } from "@/db/schema";

export type StockRow = {
  id: string;
  tag: string;
  model: string;
  serialNumber: string | null;
  specifications: string | null;
  notes: string | null;
  status: "in_stock" | "deployed" | "retired";
  issuedToName: string | null;
  issuedOn: string | null;
  issueNote: string | null;
  createdAt: Date;
};

export async function listStock(): Promise<StockRow[]> {
  return getDb()
    .select({
      id: stockItems.id,
      tag: stockItems.tag,
      model: stockItems.model,
      serialNumber: stockItems.serialNumber,
      specifications: stockItems.specifications,
      notes: stockItems.notes,
      status: stockItems.status,
      issuedToName: stockItems.issuedToName,
      issuedOn: stockItems.issuedOn,
      issueNote: stockItems.issueNote,
      createdAt: stockItems.createdAt,
    })
    .from(stockItems)
    .orderBy(asc(stockItems.tag));
}

export type StockView = "in_stock" | "deployed" | "retired" | "all";

export const parseStockView = (v: string | undefined): StockView =>
  v === "deployed" || v === "retired" || v === "all" ? v : "in_stock";

/** Names to suggest when checking stock out (people who have not left). */
export async function listPeopleNames(): Promise<string[]> {
  const rows = await getDb()
    .select({ name: people.fullName })
    .from(people)
    .where(ne(people.status, "left"))
    .orderBy(asc(people.fullName));
  return rows.map((r) => r.name);
}
