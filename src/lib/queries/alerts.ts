import "server-only";
import { and, eq, gte, lt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { alertStates, subscriptions, tasks, vendors } from "@/db/schema";
import {
  applyAlertStates,
  deriveAlerts,
  OVERDUE_ALERT_DAYS,
  type AlertWithState,
} from "@/lib/alerts";
import { addDays } from "@/lib/dates";
import { renewalDue } from "@/lib/dashboard";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { listPurchaseOrders } from "./procurement";

/** Current alerts (dismissed ones removed), derived from live data. */
export async function getAlerts(today: string): Promise<AlertWithState[]> {
  const db = getDb();
  const [subs, overdue, pos, states] = await Promise.all([
    db
      .select({
        id: subscriptions.id,
        name: subscriptions.name,
        kind: subscriptions.kind,
        billingCycle: subscriptions.billingCycle,
        nextChargeDate: subscriptions.nextChargeDate,
        renewalDate: subscriptions.renewalDate,
        contractEndDate: subscriptions.contractEndDate,
        costAed: subscriptions.costAed,
        vendor: vendors.name,
      })
      .from(subscriptions)
      .innerJoin(vendors, eq(vendors.id, subscriptions.vendorId))
      .where(eq(subscriptions.active, true)),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          ne(tasks.status, "done"),
          lt(tasks.dueDate, today),
          gte(tasks.dueDate, addDays(today, -OVERDUE_ALERT_DAYS)),
        ),
      ),
    listPurchaseOrders(),
    db.select().from(alertStates),
  ]);

  const renewals = subs.flatMap((s) => {
    const due = renewalDue(s);
    return due
      ? [
          {
            id: s.id,
            name: s.name,
            vendor: s.vendor,
            kind: s.kind,
            due,
            costAed: s.costAed,
          },
        ]
      : [];
  });
  const alerts = deriveAlerts({
    today,
    currency: (await getWorkspaceSettings()).baseCurrency,
    renewals,
    overdueTasks: overdue.flatMap((t) => (t.dueDate ? [{ ...t, dueDate: t.dueDate }] : [])),
    pos,
  });
  return applyAlertStates(alerts, new Map(states.map((s) => [s.alertKey, s.state])));
}
