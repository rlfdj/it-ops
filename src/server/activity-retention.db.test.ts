// Activity log retention: entries older than two years go; everything else stays append-only.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { inRollback } from "../test/db.ts";
import type { Tx } from "../db/actor.ts";
import { activityLog } from "../db/schema.ts";

const DAY = 86_400_000;

const insertAt = (tx: Tx, at: Date, label: string) =>
  tx
    .insert(activityLog)
    .values({
      at,
      actor: "test@example.test",
      action: "insert",
      tableName: "tasks",
      recordId: randomUUID(),
      recordLabel: label,
      module: "Tasks",
    })
    .returning({ id: activityLog.id });

describe("activity log retention", () => {
  it("prune_activity_log removes entries older than two years and keeps newer ones", () =>
    inRollback(async (tx) => {
      const [old] = await insertAt(tx, new Date(Date.now() - 2.1 * 365 * DAY), "E2E old entry");
      const [recent] = await insertAt(tx, new Date(Date.now() - 30 * DAY), "E2E recent entry");
      const rows = (await tx.execute(
        sql`select public.prune_activity_log() as removed`,
      )) as unknown as {
        removed: number;
      }[];
      expect(Number(rows[0]?.removed)).toBeGreaterThanOrEqual(1);
      expect(await tx.select().from(activityLog).where(eq(activityLog.id, old!.id))).toHaveLength(
        0,
      );
      expect(
        await tx.select().from(activityLog).where(eq(activityLog.id, recent!.id)),
      ).toHaveLength(1);
    }));

  it("a plain delete is still refused, even of an old entry", () =>
    inRollback(async (tx) => {
      const [old] = await insertAt(tx, new Date(Date.now() - 3 * 365 * DAY), "E2E old entry");
      await expect(tx.delete(activityLog).where(eq(activityLog.id, old!.id))).rejects.toThrow();
    }));

  it("updates are still refused", () =>
    inRollback(async (tx) => {
      const [row] = await insertAt(tx, new Date(), "E2E entry");
      await expect(
        tx.update(activityLog).set({ recordLabel: "changed" }).where(eq(activityLog.id, row!.id)),
      ).rejects.toThrow();
    }));
});
