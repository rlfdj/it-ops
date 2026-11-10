import type { Metadata } from "next";
import { getToday } from "@/lib/queries/settings";
import { requireUser } from "@/lib/auth";
import { actorName } from "@/lib/activity";
import { getDb, SYSTEM_ACTOR, withActor } from "@/db";
import { pruneActivityLog } from "@/server/activity-retention";
import { ensureInvoicePeriods } from "@/server/subscriptions";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  // Business rule 4: roll subscription billing periods forward on dashboard load
  // (idempotent; a scheduled job can take this over later).
  try {
    const today = await getToday();
    await withActor(SYSTEM_ACTOR, (tx) => ensureInvoicePeriods(tx, today));
  } catch (error) {
    console.error("ensureInvoicePeriods failed", error);
  }
  // Activity log entries older than two years are removed (owner rule; throttled).
  try {
    await pruneActivityLog(getDb());
  } catch (error) {
    console.error("pruneActivityLog failed", error);
  }
  return <DashboardView name={actorName(user.email)} />;
}
