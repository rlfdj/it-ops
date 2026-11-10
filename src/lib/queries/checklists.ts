import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { checklistItems, checklistTemplates, checklists, people, tasks } from "@/db/schema";
import { stepsOrDefault, type TemplateStep } from "@/lib/checklist-templates";
import { progress, type ChecklistKind, type Section } from "@/lib/checklists";

export type ChecklistSummary = {
  id: string;
  kind: ChecklistKind;
  status: "open" | "completed" | "cancelled";
  targetDate: string;
  updatedAt: Date;
  person: { id: string; name: string; department: string | null; managerName: string | null };
  done: number;
  total: number;
  overdue: number;
};

/** Every checklist with its progress over top-level items. */
export async function listChecklists(today: string): Promise<ChecklistSummary[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: checklists.id,
      kind: checklists.kind,
      status: checklists.status,
      targetDate: checklists.targetDate,
      updatedAt: checklists.updatedAt,
      personId: people.id,
      name: people.fullName,
      department: people.department,
      managerName: people.managerName,
    })
    .from(checklists)
    .innerJoin(people, eq(people.id, checklists.personId))
    .orderBy(asc(checklists.targetDate));
  if (!rows.length) return [];
  const items = await db
    .select({
      checklistId: checklistItems.checklistId,
      parentId: checklistItems.parentId,
      doneAt: checklistItems.doneAt,
      notApplicable: checklistItems.notApplicable,
      dueDate: checklistItems.dueDate,
    })
    .from(checklistItems)
    .where(
      inArray(
        checklistItems.checklistId,
        rows.map((r) => r.id),
      ),
    );
  const byChecklist = Map.groupBy(
    items.filter((i) => !i.parentId),
    (i) => i.checklistId,
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    targetDate: r.targetDate,
    updatedAt: r.updatedAt,
    person: { id: r.personId, name: r.name, department: r.department, managerName: r.managerName },
    ...progress(byChecklist.get(r.id) ?? [], today),
  }));
}

export type ChecklistItemNode = {
  id: string;
  section: Section;
  label: string;
  detail: string | null;
  dueDate: string | null;
  doneAt: Date | null;
  notApplicable: boolean;
  taskId: string | null;
  children: ChecklistItemNode[];
};

/** A checklist's items as a tree (top-level items with their pieces of equipment). */
export async function getChecklistItems(checklistId: string): Promise<ChecklistItemNode[]> {
  const rows = await getDb()
    .select({
      id: checklistItems.id,
      parentId: checklistItems.parentId,
      section: checklistItems.section,
      label: checklistItems.label,
      detail: checklistItems.detail,
      dueDate: checklistItems.dueDate,
      doneAt: checklistItems.doneAt,
      notApplicable: checklistItems.notApplicable,
      taskId: tasks.id,
    })
    .from(checklistItems)
    .leftJoin(tasks, eq(tasks.checklistItemId, checklistItems.id))
    .where(eq(checklistItems.checklistId, checklistId))
    .orderBy(asc(checklistItems.sort), asc(checklistItems.createdAt));
  const node = (r: (typeof rows)[number]): ChecklistItemNode => ({
    id: r.id,
    section: r.section,
    label: r.label,
    detail: r.detail,
    dueDate: r.dueDate,
    doneAt: r.doneAt,
    notApplicable: r.notApplicable,
    taskId: r.taskId,
    children: [],
  });
  const top = rows.filter((r) => !r.parentId).map(node);
  const byId = new Map(top.map((n) => [n.id, n]));
  for (const r of rows) if (r.parentId) byId.get(r.parentId)?.children.push(node(r));
  return top;
}

/** People who can be picked when starting a checklist (not left). */
export async function listPeople() {
  return getDb()
    .select({
      id: people.id,
      name: people.fullName,
      department: people.department,
      status: people.status,
    })
    .from(people)
    .orderBy(desc(people.status), asc(people.fullName));
}

/** The saved on/offboarding templates as the items a new checklist starts with. */
export async function getChecklistTemplates(): Promise<Record<ChecklistKind, TemplateStep[]>> {
  const rows = await getDb().select().from(checklistTemplates);
  const stored = (kind: ChecklistKind) => rows.find((r) => r.kind === kind)?.steps;
  return {
    onboarding: stepsOrDefault("onboarding", stored("onboarding")),
    offboarding: stepsOrDefault("offboarding", stored("offboarding")),
  };
}
