// Workspace settings: one row.

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb, Tx } from "../db/actor.ts";
import { workspaceSettings } from "../db/schema.ts";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIME_ZONE,
  isBaseCurrency,
  isValidTimeZone,
  type WorkspaceSettings,
} from "../lib/workspace.ts";

export const settingsInput = z.object({
  workspaceName: z.string().trim().min(1, "Give the workspace a name.").max(60),
  usdAedRate: z.coerce
    .number({ error: "Enter the exchange rate as a number." })
    .gt(0, "The rate must be above zero.")
    .lt(100, "That rate looks wrong.")
    .transform((n) => Math.round(n * 10_000) / 10_000),
  baseCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isBaseCurrency, "Choose a currency from the list.")
    .optional(),
  timeZone: z
    .string()
    .trim()
    .refine(isValidTimeZone, "Choose a time zone from the list.")
    .optional(),
});

export async function saveSettings(tx: Tx, input: z.input<typeof settingsInput>) {
  const data = settingsInput.parse(input);
  const values = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as {
    workspaceName: string;
    usdAedRate: number;
    baseCurrency?: string;
    timeZone?: string;
  };
  await tx
    .insert(workspaceSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: { ...values, updatedAt: new Date() },
    });
  return data;
}

/** Sets or clears the custom logo; returns the storage path it replaced (to delete). */
export async function setLogoPath(tx: Tx, logoPath: string | null): Promise<string | null> {
  const [before] = await tx
    .select({ logoPath: workspaceSettings.logoPath })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, 1));
  await tx
    .insert(workspaceSettings)
    .values({ id: 1, logoPath })
    .onConflictDoUpdate({
      target: workspaceSettings.id,
      set: { logoPath, updatedAt: new Date() },
    });
  return before?.logoPath ?? null;
}

/** The settings row (the defaults when settings were never saved). */
export async function getSettingsTx(tx: Tx): Promise<WorkspaceSettings> {
  const [row] = await tx.select().from(workspaceSettings).where(eq(workspaceSettings.id, 1));
  return row
    ? {
        workspaceName: row.workspaceName,
        usdAedRate: row.usdAedRate,
        baseCurrency: row.baseCurrency,
        timeZone: row.timeZone,
        logoPath: row.logoPath,
      }
    : DEFAULT_SETTINGS;
}

/** The base-currency units per USD in force (the default when settings were never saved). */
export async function getUsdRate(tx: Tx, fallback: number): Promise<number> {
  const [row] = await tx
    .select({ rate: workspaceSettings.usdAedRate })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, 1));
  return row?.rate ?? fallback;
}

/** The USD rate and base currency in force, for converting amounts as they are saved. */
export async function getBilling(tx: Tx): Promise<{ usdRate: number; baseCurrency: string }> {
  const s = await getSettingsTx(tx);
  return { usdRate: s.usdAedRate, baseCurrency: s.baseCurrency };
}

/** The workspace time zone, read inside a transaction. */
export async function getTimeZoneTx(tx: AppDb | Tx): Promise<string> {
  const [row] = await tx
    .select({ timeZone: workspaceSettings.timeZone })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.id, 1));
  return row?.timeZone ?? DEFAULT_TIME_ZONE;
}
