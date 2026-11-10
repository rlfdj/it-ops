import "server-only";
import { cache } from "react";
import { unstable_cache, updateTag } from "next/cache";
import { getDb } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { todayIn } from "@/lib/dates";
import { DEFAULT_SETTINGS, type WorkspaceSettings } from "@/lib/workspace";

export type { WorkspaceSettings };

const TAG = "workspace-settings";

/** Drops the cached settings everywhere (called from the Settings server actions). */
export function invalidateSettingsCache() {
  updateTag(TAG);
}

async function readSettings(): Promise<WorkspaceSettings> {
  const [row] = await getDb().select().from(workspaceSettings).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    workspaceName: row.workspaceName,
    usdAedRate: row.usdAedRate,
    baseCurrency: row.baseCurrency,
    timeZone: row.timeZone,
    logoPath: row.logoPath,
  };
}

// Next's data cache is shared by every request and every route, and survives across
// server instances; the tag lets a save drop it at once.
const readCached = unstable_cache(readSettings, [TAG], { tags: [TAG], revalidate: 30 });

/**
 * The workspace settings, or the defaults when none were saved. Cached for 30 seconds
 * (and dropped on save), so a request does not query them again.
 */
export const getWorkspaceSettings = cache(async (): Promise<WorkspaceSettings> => readCached());

/** The workspace time zone (IANA name). */
export const getTimeZone = async () => (await getWorkspaceSettings()).timeZone;

/** The workspace's `YYYY-MM-DD` today. */
export async function getToday(now: Date = new Date()) {
  return todayIn(await getTimeZone(), now);
}
