import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, checklistTemplates } from "@/db/schema";
import { client, inRollback } from "@/test/db";
import { getChecklistTemplatesTx, saveChecklistTemplate } from "./checklist-templates";

afterAll(() => client.end());

describe("checklist templates", () => {
  it("saves a template, reads it back and logs the edit", async () => {
    await inRollback(async (tx) => {
      await saveChecklistTemplate(tx, {
        kind: "offboarding",
        steps: [{ label: " TEST Disable email " }, { label: "TEST Archive files" }],
      });
      const read = await getChecklistTemplatesTx(tx);
      expect(read.offboarding.map((s) => s.label)).toEqual([
        "TEST Disable email",
        "TEST Archive files",
      ]);
      const [log] = await tx
        .select()
        .from(activityLog)
        .where(eq(activityLog.tableName, "checklist_templates"));
      expect(log?.recordLabel).toBe("offboarding");
    });
  });

  it("falls back to the starting steps for an empty template, and validates", async () => {
    await inRollback(async (tx) => {
      await tx.delete(checklistTemplates);
      const read = await getChecklistTemplatesTx(tx);
      expect(read.onboarding[0]?.label).toBe("Create email account");
      await expect(
        saveChecklistTemplate(tx, { kind: "onboarding", steps: [{ label: " " }] }),
      ).rejects.toThrow();
    });
  });
});
