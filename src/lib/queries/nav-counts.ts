import "server-only";
import { count, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { checklists, purchaseOrders, stockItems, subscriptions, tasks } from "@/db/schema";
import type { ModuleKey } from "@/lib/nav";

export type NavCounts = Partial<Record<ModuleKey, number>>;

export async function getNavCounts(): Promise<NavCounts> {
  const db = getDb();
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

  const [openPos, inStock, pendingTasks, activeSubs, openChecklists] = await Promise.all([
    one(db.select({ n: count() }).from(purchaseOrders).where(ne(purchaseOrders.status, "closed"))),
    one(db.select({ n: count() }).from(stockItems).where(eq(stockItems.status, "in_stock"))),
    one(db.select({ n: count() }).from(tasks).where(ne(tasks.status, "done"))),
    one(db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.active, true))),
    one(db.select({ n: count() }).from(checklists).where(eq(checklists.status, "open"))),
  ]);

  return {
    procurement: openPos,
    stock: inStock,
    tasks: pendingTasks,
    subscriptions: activeSubs,
    onboarding: openChecklists,
  };
}
