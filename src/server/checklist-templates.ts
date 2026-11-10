// Editable checklist templates (one row per kind).

import { z } from "zod";
import type { Tx } from "../db/actor.ts";
import { checklistTemplates } from "../db/schema.ts";
import { DomainError } from "../lib/domain-error.ts";
import {
  MAX_STEP_LABEL,
  MAX_TEMPLATE_STEPS,
  cleanSteps,
  stepsOrDefault,
  type TemplateStep,
} from "../lib/checklist-templates.ts";
import type { ChecklistKind } from "../lib/checklists.ts";

export const templateInput = z.object({
  kind: z.enum(["onboarding", "offboarding"]),
  steps: z
    .array(
      z.object({
        label: z
          .string()
          .trim()
          .min(1, "Every step needs a name.")
          .max(MAX_STEP_LABEL, "A step name is too long."),
        detail: z.string().optional(),
      }),
    )
    .max(MAX_TEMPLATE_STEPS, `Use at most ${MAX_TEMPLATE_STEPS} steps.`),
});

/** Saves the steps of one template. Existing checklists are not touched. */
export async function saveChecklistTemplate(tx: Tx, input: z.input<typeof templateInput>) {
  const parsed = templateInput.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]!.message);
  const steps = cleanSteps(parsed.data.steps);
  await tx
    .insert(checklistTemplates)
    .values({ kind: parsed.data.kind, steps })
    .onConflictDoUpdate({
      target: checklistTemplates.kind,
      set: { steps, updatedAt: new Date() },
    });
  return steps;
}

/** Both templates (the starting steps for a kind with nothing saved). */
export async function getChecklistTemplatesTx(
  tx: Tx,
): Promise<Record<ChecklistKind, TemplateStep[]>> {
  const rows = await tx.select().from(checklistTemplates);
  const stored = (kind: ChecklistKind) => rows.find((r) => r.kind === kind)?.steps;
  return {
    onboarding: stepsOrDefault("onboarding", stored("onboarding")),
    offboarding: stepsOrDefault("offboarding", stored("offboarding")),
  };
}
