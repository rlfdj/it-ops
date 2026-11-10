import { ExportButton } from "@/components/export-button";
import { ListFilter } from "@/components/list-controls";
import { ViewTabs } from "@/components/view-tabs";
import { filterRows, parseSort, sortParam, sortRows, textParam } from "@/lib/list-view";
import { keysOf, TASK_SORT_COLUMNS, TASK_SORTS, taskSearchFields } from "@/lib/list-sorts";
import { todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { isOverdue } from "@/lib/tasks";
import { listTaskLinkOptions, listTasks } from "@/lib/queries/tasks";
import { NewTaskDialog } from "./new-task-dialog";
import { QuickAdd } from "./quick-add";
import { TasksTable } from "./tasks-table";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VIEWS = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
] as const;

export async function TasksView({ params }: { params: Params }) {
  const today = todayIn((await getWorkspaceSettings()).timeZone);
  const viewParam = one(params.view);
  const view = viewParam === "done" || viewParam === "all" ? viewParam : "open";
  const creating = one(params.new) === "1";
  const q = textParam(params.q);
  const sort = parseSort(one(params.sort), keysOf(TASK_SORT_COLUMNS));
  const [all, linkOptions] = await Promise.all([
    listTasks(),
    creating ? listTaskLinkOptions() : Promise.resolve([]),
  ]);
  const open = all.filter((t) => t.status !== "done");
  // View counts follow the text filter, so the numbers agree with the list.
  const matched = filterRows(all, q, taskSearchFields);
  const filtered = Boolean(q);
  const countOf = (v: (typeof VIEWS)[number]["value"]) =>
    v === "open"
      ? matched.filter((t) => t.status !== "done").length
      : v === "done"
        ? matched.filter((t) => t.status === "done").length
        : matched.length;
  const rows = sortRows(
    view === "open"
      ? matched.filter((t) => t.status !== "done")
      : view === "done"
        ? matched.filter((t) => t.status === "done")
        : matched,
    sort,
    TASK_SORTS,
  );
  const viewHref = (v: string) => {
    const next = new URLSearchParams();
    if (v !== "open") next.set("view", v);
    if (q) next.set("q", q);
    if (sort) next.set("sort", sortParam(sort)!);
    return next.size ? `/tasks?${next}` : "/tasks";
  };
  const overdue = open.filter((t) => isOverdue(t.dueDate, t.status, today)).length;
  const fromChecklists = open.filter((t) => t.fromChecklist).length;

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">
            {open.length} open · {overdue} overdue · {fromChecklists} from checklists
          </span>
          <h1 className="h1">Tasks</h1>
        </div>
        <div className="right">
          <ExportButton
            href={q ? `/tasks/export?q=${encodeURIComponent(q)}` : "/tasks/export"}
            empty={all.length === 0}
            title={q ? "Exports the tasks matching the filter text" : undefined}
          />
        </div>
      </div>

      <QuickAdd today={today} />

      <div className="toolbar">
        <ViewTabs
          label="Show"
          tabs={VIEWS.map((v) => ({
            key: v.value,
            label: v.label,
            count: countOf(v.value),
            href: viewHref(v.value),
            current: view === v.value,
          }))}
        />
        <span className="toolbar-tools">
          <ListFilter
            key={q}
            label="Filter tasks"
            placeholder="Task or related record"
            initial={q}
          />
        </span>
      </div>

      <NewTaskDialog open={creating} options={linkOptions} />

      <TasksTable
        key={view}
        rows={rows}
        today={today}
        sort={sort}
        doneSeparately={view !== "all"}
        emptyMessage={
          filtered
            ? "No tasks match the filter."
            : view === "done"
              ? "Nothing finished yet."
              : "Nothing here. New checklist items will appear automatically."
        }
      />
    </main>
  );
}
