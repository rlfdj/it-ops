// What each list can be sorted and searched by (B-09), shared by the screens and the CSV
// exports so a filtered export matches the filtered screen.

import type { SortColumn } from "../components/list-controls.tsx";
import { STAGE_LABEL, PO_STAGES } from "./procurement.ts";
import type { PoListRow } from "./queries/procurement.ts";
import type { SubscriptionRow } from "./queries/subscriptions.ts";
import type { TaskRow } from "./queries/tasks.ts";

type Getters<T> = Record<string, (row: T) => string | number | null>;

export const PO_SORT_COLUMNS: SortColumn[] = [
  { key: "requested", label: "Requested", first: "desc" },
  { key: "vendor", label: "Vendor" },
  { key: "amount", label: "Amount", first: "desc" },
  { key: "status", label: "Status" },
];
export const PO_SORTS: Getters<PoListRow> = {
  requested: (p) => p.requestedOn,
  vendor: (p) => p.vendor,
  amount: (p) => p.totalAed,
  status: (p) => PO_STAGES.indexOf(p.status),
};
export const poSearchFields = (p: PoListRow) => [
  p.poNumber,
  p.vendor,
  p.project ?? "",
  p.invoiceNumber ?? "",
  p.summary,
  STAGE_LABEL[p.status],
];

export const SUB_SORT_COLUMNS: SortColumn[] = [
  { key: "name", label: "Name" },
  { key: "paid", label: "Last paid", first: "desc" },
  { key: "next", label: "Next charge" },
];
export const SUB_SORTS: Getters<SubscriptionRow> = {
  name: (s) => s.name,
  paid: (s) => s.lastPaidDate,
  next: (s) => s.nextChargeDate,
};
export const subSearchFields = (s: SubscriptionRow) => [
  s.name,
  s.vendor,
  s.plan,
  s.userName,
  s.project,
];

export const TASK_SORT_COLUMNS: SortColumn[] = [
  { key: "title", label: "Task" },
  { key: "due", label: "Due" },
  { key: "priority", label: "Priority" },
];
export const TASK_SORTS: Getters<TaskRow> = {
  title: (t) => t.title,
  due: (t) => t.dueDate,
  priority: (t) => t.priority,
};
export const taskSearchFields = (t: TaskRow) => [t.title, t.related?.label, t.sourceLabel, t.notes];

export const keysOf = (columns: SortColumn[]) => columns.map((c) => c.key);
