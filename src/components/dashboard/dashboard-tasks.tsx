"use client";

import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { dashGroup, type DashGroup } from "@/lib/dashboard";
import { formatDue } from "@/lib/tasks";
import type { TaskRow } from "@/lib/queries/tasks";
import { toggleTask } from "@/app/(app)/tasks/actions";
import { QuickAdd } from "@/components/tasks/quick-add";

const GROUPS: { key: DashGroup; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "c-red" },
  { key: "week", label: "This week", tone: "c-amber" },
  { key: "later", label: "Later", tone: "c-grey" },
];
const PER_GROUP = 8;

/** Open tasks grouped Overdue / This week / Later, tickable in place. */
export function DashboardTasks({ tasks, today }: { tasks: TaskRow[]; today: string }) {
  const router = useRouter();
  // Ticked in this session: stays visible (struck through) until the page reloads.
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const tick = (id: string, value: boolean) => {
    setDone((d) => ({ ...d, [id]: value }));
    setError(null);
    void toggleTask(id, value).then((result) => {
      if (!result.ok) {
        setDone((d) => ({ ...d, [id]: !value }));
        setError(result.error);
      } else router.refresh();
    });
  };

  const byGroup = Map.groupBy(tasks, (t) => dashGroup(t.dueDate, today));
  const open = tasks.filter((t) => !done[t.id]).length;

  return (
    <section aria-label="Open tasks" className="flex min-w-0 flex-col">
      <div className="sec-head">
        <div className="lead">
          <h2 className="h2">Open tasks</h2>
          <span className="cap">{open} open</span>
        </div>
        <Link href="/tasks" className="link whitespace-nowrap">
          All tasks →
        </Link>
      </div>
      <QuickAdd today={today} />
      {error ? (
        <p className="alert red sm box my-2" role="alert">
          {error}
        </p>
      ) : null}
      {tasks.length === 0 ? (
        <div className="mt-3.5">
          <EmptyState title="Nothing open">Add a task above to get started.</EmptyState>
        </div>
      ) : null}
      {GROUPS.map((g) => {
        const rows = byGroup.get(g.key) ?? [];
        if (!rows.length) return null;
        const shown = rows.slice(0, PER_GROUP);
        return (
          <div key={g.key} className="drow-group flex flex-col">
            <div className={`group-head ${g.tone}`}>
              <b>{g.label}</b>
              <span className="n">{rows.filter((t) => !done[t.id]).length}</span>
            </div>
            {shown.map((t) => (
              <div key={t.id} className={`drow${done[t.id] ? " done" : ""}`}>
                <input
                  type="checkbox"
                  checked={Boolean(done[t.id])}
                  onChange={(e) => tick(t.id, e.target.checked)}
                  aria-label={`Mark done: ${t.title}`}
                />
                <span className="t">{t.title}</span>
                {t.related ? (
                  <Link
                    href={t.related.href}
                    className={`${t.related.mono ? "lnk" : "link"} rel trunc`}
                    title={t.related.label}
                  >
                    {t.related.label}
                  </Link>
                ) : (
                  <span className="rel" />
                )}
                <span className={`due ${g.key === "overdue" ? "" : "muted"}`}>
                  {g.key === "overdue" && t.dueDate ? (
                    <span className="st urgent c-red">{formatDue(t.dueDate, today)}</span>
                  ) : t.dueDate ? (
                    formatDue(t.dueDate, today)
                  ) : (
                    "—"
                  )}
                </span>
              </div>
            ))}
            {rows.length > PER_GROUP ? (
              <Link href="/tasks" className="link py-2 text-[12px]">
                {rows.length - PER_GROUP} more →
              </Link>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
