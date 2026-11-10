// Editable checklist templates: the account steps new on/offboarding checklists start with.
// Pure functions. The equipment step is built in (see EQUIPMENT_ITEM) and is not stored.

import { EQUIPMENT_ITEM, type ChecklistKind, type TemplateItem } from "./checklists.ts";

export type TemplateStep = { label: string; detail?: string };

export const MAX_TEMPLATE_STEPS = 40;
export const MAX_STEP_LABEL = 200;
const MAX_STEP_DETAIL = 500;

/** The starting templates (also the fallback when nothing is saved). */
export const STARTING_STEPS: Record<ChecklistKind, TemplateStep[]> = {
  offboarding: [
    { label: "Disable email account" },
    { label: "Remove from team chat and shared drives" },
    { label: "Revoke VPN and remote access" },
    { label: "Transfer or archive their files" },
  ],
  onboarding: [
    { label: "Create email account" },
    { label: "Add to team chat and shared drives" },
    { label: "Set up VPN and remote access" },
  ],
};

/**
 * Reads a stored value (jsonb) into steps. Anything that is not an array of objects with a
 * label is dropped; null, a non-array or an empty result gives null (callers fall back).
 */
export function parseStoredSteps(value: unknown): TemplateStep[] | null {
  if (!Array.isArray(value)) return null;
  const steps: TemplateStep[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const { label, detail } = raw as { label?: unknown; detail?: unknown };
    if (typeof label !== "string" || !label.trim()) continue;
    const step: TemplateStep = { label: label.trim() };
    if (typeof detail === "string" && detail.trim()) step.detail = detail.trim();
    steps.push(step);
  }
  return steps.length > 0 ? steps.slice(0, MAX_TEMPLATE_STEPS) : null;
}

/** The saved steps, or the starting steps when none are saved. */
export const stepsOrDefault = (kind: ChecklistKind, stored: unknown): TemplateStep[] =>
  parseStoredSteps(stored) ?? STARTING_STEPS[kind];

/** First problem with a list of steps being saved, or null when it is fine. */
export function validateSteps(steps: { label: string }[]): string | null {
  if (steps.length > MAX_TEMPLATE_STEPS) return `Use at most ${MAX_TEMPLATE_STEPS} steps.`;
  for (const [i, step] of steps.entries()) {
    const label = step.label.trim();
    if (!label) return `Step ${i + 1} needs a name.`;
    if (label.length > MAX_STEP_LABEL)
      return `Step ${i + 1} is too long (up to ${MAX_STEP_LABEL} characters).`;
  }
  return null;
}

/** Trims labels and details, dropping empty details. */
export function cleanSteps(steps: TemplateStep[]): TemplateStep[] {
  return steps.map((s) => {
    const step: TemplateStep = { label: s.label.trim() };
    const detail = s.detail?.trim().slice(0, MAX_STEP_DETAIL);
    if (detail) step.detail = detail;
    return step;
  });
}

/** The items a new checklist of `kind` starts with: the equipment step, then the saved steps. */
export function buildTemplateItems(kind: ChecklistKind, steps: TemplateStep[]): TemplateItem[] {
  return [
    EQUIPMENT_ITEM[kind],
    ...steps.map((s): TemplateItem => ({
      section: "accounts",
      label: s.label,
      ...(s.detail ? { detail: s.detail } : {}),
    })),
  ];
}
