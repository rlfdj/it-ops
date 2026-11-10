"use server";

import { withActor } from "@/db";
import { requireUser } from "@/lib/auth";
import { markAlertsRead, setAlertState } from "@/server/alerts";

export async function updateAlert(key: string, state: "read" | "dismissed"): Promise<boolean> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => setAlertState(tx, key, state));
    return true;
  } catch (error) {
    console.error("updateAlert failed", error);
    return false;
  }
}

export async function readAllAlerts(keys: string[]): Promise<boolean> {
  try {
    const user = await requireUser();
    await withActor(user.email, (tx) => markAlertsRead(tx, keys));
    return true;
  } catch (error) {
    console.error("readAllAlerts failed", error);
    return false;
  }
}
