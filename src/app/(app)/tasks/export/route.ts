import type { NextRequest } from "next/server";
import { csvDownload } from "@/lib/csv-response";
import { formatDate } from "@/lib/dates";
import { STATUS_LABEL } from "@/lib/tasks";
import { listTasks } from "@/lib/queries/tasks";
import { filterRows, textParam } from "@/lib/list-view";
import { taskSearchFields } from "@/lib/list-sorts";

/** Every task (open and done) as CSV; `?q=` limits it to the list's filter text (named so). */
export function GET(request: NextRequest) {
  const q = textParam(request.nextUrl.searchParams.get("q") ?? undefined);
  return csvDownload(request, q ? "tasks-filtered" : "tasks", async ({ timeZone }) => {
    const rows = filterRows(await listTasks(), q, taskSearchFields);
    return {
      header: ["Task", "Status", "Priority", "Due", "Source", "Related", "Done"],
      rows: rows.map((t) => [
        t.title,
        STATUS_LABEL[t.status],
        `P${t.priority}`,
        t.dueDate,
        t.sourceLabel,
        t.related?.label,
        t.doneAt ? formatDate(t.doneAt, timeZone) : null,
      ]),
    };
  });
}
