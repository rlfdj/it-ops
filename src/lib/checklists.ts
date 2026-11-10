// On/offboarding checklist rules. Pure functions.

export type ChecklistKind = "onboarding" | "offboarding";
export type Section = "accounts" | "assets" | "licences" | "sim";

/** Section headings. The `assets` section holds equipment to issue or collect. */
export const SECTION_LABEL: Record<Section, string> = {
  assets: "Equipment",
  accounts: "Accounts",
  licences: "Licenses",
  sim: "SIM & telecom",
};

/** Display order of sections. */
export const SECTION_ORDER: Section[] = ["assets", "accounts", "licences", "sim"];

export const KIND_LABEL: Record<ChecklistKind, string> = {
  onboarding: "Onboarding",
  offboarding: "Offboarding",
};

export type TemplateItem = {
  section: Section;
  label: string;
  detail?: string;
  /** Has a sub-checklist of individual pieces of equipment, entered by hand. */
  equipment?: boolean;
};

/**
 * The built-in first step of every checklist: the equipment to issue or collect, with a
 * sub-checklist of individual pieces entered by hand. Not part of the editable template.
 */
export const EQUIPMENT_ITEM: Record<ChecklistKind, TemplateItem> = {
  offboarding: {
    section: "assets",
    label: "Collect equipment",
    detail: "Tick each item as it comes back",
    equipment: true,
  },
  onboarding: {
    section: "assets",
    label: "Issue equipment",
    detail: "Tick each item as it is handed over",
    equipment: true,
  },
};

/**
 * The due date an item ends up with: the one chosen for it, else the checklist's target date
 * (an offboarding checklist's target is the employee's last day).
 */
export const itemDueDate = (chosen: string | null | undefined, targetDate: string): string =>
  chosen || targetDate;

/** Task title for a checklist item, e.g. "Deactivate Jira account — Karim Saleh". */
export const taskTitle = (label: string, personName: string) => `${label} — ${personName}`;

type ItemLike = { doneAt: Date | null; notApplicable: boolean };

/** Done or not applicable — nothing left to do. */
export const isSettled = (item: ItemLike) => item.notApplicable || item.doneAt !== null;

/**
 * A parent item (e.g. "Collect equipment") is done once every one of its sub-items is
 * done or not applicable. A parent with no sub-items is ticked directly.
 */
export const parentComplete = (children: ItemLike[]) =>
  children.length > 0 && children.every(isSettled);

export type ItemState =
  | { kind: "na" }
  | { kind: "done"; at: Date }
  | { kind: "overdue"; due: string }
  | { kind: "due"; due: string }
  | { kind: "open" };

export function itemState(item: ItemLike & { dueDate: string | null }, today: string): ItemState {
  if (item.notApplicable) return { kind: "na" };
  if (item.doneAt) return { kind: "done", at: item.doneAt };
  if (!item.dueDate) return { kind: "open" };
  return item.dueDate < today
    ? { kind: "overdue", due: item.dueDate }
    : { kind: "due", due: item.dueDate };
}

/** Progress over the items that count (not applicable ones don't). */
export function progress(items: (ItemLike & { dueDate: string | null })[], today: string) {
  const counted = items.filter((i) => !i.notApplicable);
  const done = counted.filter((i) => i.doneAt !== null).length;
  const overdue = counted.filter((i) => itemState(i, today).kind === "overdue").length;
  return { done, total: counted.length, open: counted.length - done, overdue };
}
