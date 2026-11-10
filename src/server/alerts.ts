// Alert state writes. The alerts themselves are derived on read; only read / dismissed is kept.

import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { alertStates } from "../db/schema.ts";

const key = z.string().trim().min(1).max(200);
const state = z.enum(["read", "dismissed"]);

/** Marks one alert read or dismissed (idempotent). */
export async function setAlertState(tx: Tx, rawKey: string, rawState: "read" | "dismissed") {
  const alertKey = key.parse(rawKey);
  const next = state.parse(rawState);
  await tx
    .insert(alertStates)
    .values({ alertKey, state: next })
    .onConflictDoUpdate({
      target: alertStates.alertKey,
      set: { state: next, updatedAt: new Date() },
    });
}

/** Marks every given alert read, leaving dismissed ones dismissed. */
export async function markAlertsRead(tx: Tx, rawKeys: string[]) {
  const keys = z.array(key).max(200).parse(rawKeys);
  if (!keys.length) return;
  await tx
    .insert(alertStates)
    .values(keys.map((alertKey) => ({ alertKey, state: "read" as const })))
    .onConflictDoNothing();
}
