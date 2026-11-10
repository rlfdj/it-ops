"use client";

import { DateField } from "@/components/date-field";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "@/components/link";
import { StickyNote } from "lucide-react";
import { IconTip } from "@/components/icon-action";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ariaSort, SortHeader, SortSelect } from "@/components/list-controls";
import type { Sort } from "@/lib/list-view";
import { TASK_SORT_COLUMNS } from "@/lib/list-sorts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { TableHint } from "@/components/table-hint";
import { useShortcut, type ShortcutCommand } from "@/hooks/use-shortcut";
import {
  focusRow,
  ROW_ID_ATTR,
  rowArrowKeys,
  stepIndex,
  useFocusRestore,
} from "@/hooks/use-row-focus";
import { hasErrors, validateTask, without, type FieldErrors } from "@/lib/form-validation";
import type { TaskSnapshot } from "@/server/tasks";
import {
  DUE_GROUP_LABEL,
  DUE_GROUP_TONE,
  dueGroup,
  formatDue,
  isOverdue,
  STATUS_LABEL,
  STATUS_TONE,
  type DueGroup,
  type TaskStatus,
} from "@/lib/tasks";
import type { TaskLinkOption, TaskRow } from "@/lib/queries/tasks";
import {
  bulkEditTasks,
  loadTaskLinkOptions,
  removeTask,
  removeTasks,
  saveTask,
  toggleTask,
  undoBulkEditTasks,
  undoRemoveTask,
  undoRemoveTasks,
} from "@/app/(app)/tasks/actions";

// Below ~980px of table width the rows collapse to a task line plus a due / priority /
// status / related line (see [data-rt="tasks"] in globals.css), so nothing scrolls away (B-06).
const COLS = "28px 34px minmax(260px, 2fr) 150px minmax(130px, 1fr) 110px 70px 120px 64px";
const SORTABLE: Record<string, string> = { title: "title", due: "due", priority: "priority" };
const sortColumn = (key: string) => TASK_SORT_COLUMNS.find((c) => c.key === key)!;
const PRIORITY_TITLE: Record<number, string> = { 1: "High", 2: "Normal", 3: "Low" };
const ORDER: (DueGroup | "done")[] = ["overdue", "week", "later", "none", "done"];

function EditTask({
  task,
  onClose,
  onSaved,
  onDeleted,
}: {
  task: TaskRow;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: (snapshot: TaskSnapshot) => void;
}) {
  const ids = useId();
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [priority, setPriority] = useState(String(task.priority));
  const [status, setStatus] = useState<TaskStatus>(task.status);
  // The Related field: what is typed, the records it can match (loaded now), and whether it was touched.
  const [notes, setNotes] = useState(task.notes);
  const [related, setRelated] = useState(task.related?.label ?? "");
  const [relatedDirty, setRelatedDirty] = useState(false);
  const [options, setOptions] = useState<TaskLinkOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (task.fromChecklist) return;
    let live = true;
    void loadTaskLinkOptions().then((r) => {
      if (live && r.ok) setOptions(r.data.options);
    });
    return () => {
      live = false;
    };
  }, [task.fromChecklist]);
  /** The record the text names: an exact label, or a PO number / name before the " · ". */
  const findOption = (text: string) => {
    const t = text.trim().toLowerCase();
    const exact = options?.find((o) => o.label.toLowerCase() === t);
    if (exact) return exact;
    const starts = options?.filter((o) => o.label.toLowerCase().startsWith(`${t} · `)) ?? [];
    return starts.length === 1 ? starts[0] : undefined;
  };
  return (
    <>
      <FormDialog
        open
        onOpenChange={(o) => (o ? null : onClose())}
        title="Edit task"
        description={
          task.fromChecklist
            ? `From a checklist (${task.sourceLabel}). Done here ticks it there too.`
            : undefined
        }
        footer={
          <>
            {error ? (
              <p className="alert red sm mr-auto self-center" role="alert">
                {error}
              </p>
            ) : null}
            {!task.fromChecklist ? (
              <Button
                variant="ghost"
                className="mr-auto"
                disabled={pending}
                onClick={() => setConfirming(true)}
              >
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <form
          id={`${ids}-form`}
          className="grid gap-4 sm:grid-cols-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const found = validateTask({ title, dueDate });
            const link = relatedDirty && related.trim() ? findOption(related) : undefined;
            if (relatedDirty && related.trim() && !link)
              found.related = "Pick a record from the list, or clear this.";
            setErrors(found);
            if (hasErrors(found)) return focusFirstInvalid(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await saveTask({
                id: task.id,
                title,
                dueDate,
                priority,
                status,
                notes,
                // Untouched keeps the current link; cleared removes it.
                ...(relatedDirty && !task.fromChecklist
                  ? { related: link ? { kind: link.kind, id: link.id } : null }
                  : {}),
              });
              if (!result.ok) setError(result.error);
              else onSaved();
            });
          }}
        >
          <div className="sm:col-span-3">
            <Field label="Task" htmlFor={`${ids}-title`} error={errors.title}>
              <input
                id={`${ids}-title`}
                className="field"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setErrors((e) => without(e, "title"));
                }}
                {...fieldProps(`${ids}-title`, errors.title)}
                autoFocus
              />
            </Field>
          </div>
          <Field label="Due" htmlFor={`${ids}-due`} error={errors.dueDate}>
            <DateField
              id={`${ids}-due`}
              className="field"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              {...fieldProps(`${ids}-due`, errors.dueDate)}
            />
          </Field>
          <Field label="Priority" htmlFor={`${ids}-p`}>
            <select
              id={`${ids}-p`}
              className="field"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="1">P1 · High</option>
              <option value="2">P2 · Normal</option>
              <option value="3">P3 · Low</option>
            </select>
          </Field>
          <Field label="Status" htmlFor={`${ids}-s`}>
            <select
              id={`${ids}-s`}
              className="field"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-3">
            {task.fromChecklist ? (
              <Field label="Related" htmlFor={`${ids}-related`} hint="Follows the checklist.">
                <input
                  id={`${ids}-related`}
                  className="field"
                  value={task.related?.label ?? "None"}
                  readOnly
                  disabled
                />
              </Field>
            ) : (
              <Field
                label="Related (optional)"
                htmlFor={`${ids}-related`}
                hint="Start typing a PO number, subscription or person."
                error={errors.related}
              >
                <span className="flex gap-2">
                  <input
                    id={`${ids}-related`}
                    className="field"
                    list={`${ids}-options`}
                    autoComplete="off"
                    value={related}
                    onChange={(e) => {
                      setRelated(e.target.value);
                      setRelatedDirty(true);
                      setErrors((all) => without(all, "related"));
                    }}
                    {...fieldProps(`${ids}-related`, errors.related)}
                  />
                  {related ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRelated("");
                        setRelatedDirty(true);
                        setErrors((all) => without(all, "related"));
                      }}
                    >
                      Clear
                    </Button>
                  ) : null}
                </span>
                <datalist id={`${ids}-options`}>
                  {(options ?? []).map((o) => (
                    <option key={`${o.kind}-${o.id}`} value={o.label} />
                  ))}
                </datalist>
              </Field>
            )}
          </div>
          <div className="sm:col-span-3">
            <Field label="Notes (optional)" htmlFor={`${ids}-notes`}>
              <textarea
                id={`${ids}-notes`}
                className="field"
                rows={4}
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
        </form>
      </FormDialog>
      {confirming ? (
        <ConfirmDialog
          title={`Delete “${task.title}”?`}
          description="This task will be removed from Tasks. You can undo it for a few seconds afterwards."
          confirmLabel="Delete task"
          pendingLabel="Deleting…"
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await removeTask(task.id);
            if (!result.ok) return result.error;
            onDeleted(result.data.snapshot);
          }}
        />
      ) : null}
    </>
  );
}

/** Set the due date or the priority of every selected task. */
function BulkEditDialog({
  kind,
  count,
  today,
  onClose,
  onApply,
}: {
  kind: "due" | "priority";
  count: number;
  today: string;
  onClose: () => void;
  onApply: (value: string) => Promise<string | void>;
}) {
  const ids = useId();
  const [value, setValue] = useState(kind === "due" ? today : "2");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const noun = `${count} ${count === 1 ? "task" : "tasks"}`;
  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : onClose())}
      title={kind === "due" ? `Set due date for ${noun}` : `Set priority for ${noun}`}
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={
              pending || (kind === "due" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value))
            }
          >
            {pending ? "Saving…" : "Apply"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const message = await onApply(value);
            if (typeof message === "string") setError(message);
          });
        }}
      >
        {kind === "due" ? (
          <Field label="Due date" htmlFor={`${ids}-v`} hint="Leave empty to remove the due date.">
            <DateField
              id={`${ids}-v`}
              className="field"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Priority" htmlFor={`${ids}-v`}>
            <select
              id={`${ids}-v`}
              className="field"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="1">P1 · High</option>
              <option value="2">P2 · Normal</option>
              <option value="3">P3 · Low</option>
            </select>
          </Field>
        )}
      </form>
    </FormDialog>
  );
}

export function TasksTable({
  rows,
  today,
  doneSeparately,
  emptyMessage,
  sort,
}: {
  rows: TaskRow[];
  today: string;
  sort: Sort | null;
  /** Group finished tasks under "Completed" instead of by due date. */
  doneSeparately: boolean;
  emptyMessage: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const container = useRef<HTMLDivElement>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulkEdit, setBulkEdit] = useState<"due" | "priority" | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isDone = useCallback(
    (t: TaskRow) => (t.id in optimistic ? optimistic[t.id]! : t.status === "done"),
    [optimistic],
  );
  const groupOf = useCallback(
    (t: TaskRow): DueGroup | "done" =>
      doneSeparately && t.status === "done" ? "done" : dueGroup(t.dueDate, today),
    [doneSeparately, today],
  );
  const ordered = useMemo(
    () => [...rows].sort((a, b) => ORDER.indexOf(groupOf(a)) - ORDER.indexOf(groupOf(b))),
    [rows, groupOf],
  );

  const tick = (t: TaskRow, done: boolean) => {
    setOptimistic((o) => ({ ...o, [t.id]: done }));
    setErrors((e) => without(e, t.id));
    void toggleTask(t.id, done).then((result) => {
      if (!result.ok) {
        setOptimistic((o) => {
          const next = { ...o };
          delete next[t.id];
          return next;
        });
        setErrors((e) => ({ ...e, [t.id]: result.error }));
      } else {
        router.refresh();
        toast.show({
          text: done ? `Marked “${t.title}” done` : `Reopened “${t.title}”`,
          undo: async () => {
            // Sets the opposite state explicitly, so running it twice changes nothing more.
            const undone = await toggleTask(t.id, !done);
            if (undone.ok) {
              setOptimistic((o) => ({ ...o, [t.id]: !done }));
              router.refresh();
            }
            return undone;
          },
        });
      }
    });
  };

  const columns = useMemo<ColumnDef<TaskRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all tasks"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select “${row.original.title}”`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        id: "done",
        header: () => <span className="sr-only">Done</span>,
        cell: ({ row: { original: t } }) => (
          <input
            type="checkbox"
            className="done-tick"
            title={isDone(t) ? "Mark not done" : "Mark done"}
            checked={isDone(t)}
            onChange={(e) => tick(t, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Mark “${t.title}” ${isDone(t) ? "not done" : "done"}`}
          />
        ),
      },
      {
        id: "title",
        header: "Task",
        cell: ({ row: { original: t } }) => (
          <span className="t font-medium whitespace-normal">
            {t.title}
            {t.notes ? (
              <IconTip label={t.notes.length > 200 ? `${t.notes.slice(0, 200)}…` : t.notes}>
                <span className="ml-1.5 inline-block align-[-2px] text-ink3">
                  <StickyNote size={13} aria-hidden />
                  <span className="sr-only">Has notes</span>
                </span>
              </IconTip>
            ) : null}
            {errors[t.id] ? (
              <span className="alert red sm mt-1" role="alert">
                {errors[t.id]}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "related",
        header: "Related",
        cell: ({ row: { original: t } }) =>
          t.related ? (
            <Link href={t.related.href} className={`block truncate ${t.related.mono ? "id" : ""}`}>
              {t.related.label}
            </Link>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row: { original: t } }) => (
          <span className="muted block truncate" title={t.sourceLabel}>
            {t.sourceShort}
          </span>
        ),
      },
      {
        id: "due",
        header: "Due",
        cell: ({ row: { original: t } }) =>
          t.dueDate ? (
            <span
              className={
                isOverdue(t.dueDate, isDone(t) ? "done" : t.status, today) ? "st c-red" : ""
              }
            >
              {formatDue(t.dueDate, today)}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        id: "priority",
        header: "Priority",
        cell: ({ row: { original: t } }) => (
          <span className={`p${t.priority}`} title={PRIORITY_TITLE[t.priority]}>
            P{t.priority}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row: { original: t } }) => {
          const status: TaskStatus = isDone(t) ? "done" : t.status === "done" ? "open" : t.status;
          return <span className={`st c-${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row: { original: t } }) => (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Edit “${t.title}”`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(t);
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDone, errors, today],
  );

  // TanStack Table returns mutable functions; fine without the React Compiler (not enabled).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: ordered,
    columns,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
    getRowId: (t) => t.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const visible = table.getRowModel().rows;
  const picked = ordered.filter((t) => selection[t.id]);
  const pickedOpen = picked.filter((t) => !isDone(t));
  const pickedManual = picked.filter((t) => !t.fromChecklist);

  const tasksLabel = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
  const applyBulk = async (change: Parameters<typeof bulkEditTasks>[0]["change"], text: string) => {
    const ids = picked.map((t) => t.id);
    const result = await bulkEditTasks({ ids, change });
    if (!result.ok) return result.error;
    const { before, changed } = result.data;
    setBulkEdit(null);
    setSelection({});
    router.refresh();
    toast.show({
      text: changed ? `${text} for ${tasksLabel(changed)}` : "Nothing needed changing",
      undo: changed
        ? async () => {
            const undone = await undoBulkEditTasks(before);
            if (undone.ok) router.refresh();
            return undone;
          }
        : undefined,
    });
  };

  const move = useCallback(
    (step: -1 | 1 | "first" | "last") => {
      const index = visible.findIndex((r) => r.original.id === cursor);
      const next = visible[stepIndex(index, visible.length, step)];
      if (!next) return;
      setCursor(next.original.id);
      focusRow(container.current, next.original.id);
    },
    [visible, cursor],
  );

  const onShortcut = useCallback(
    (command: ShortcutCommand) => {
      if (editing || visible.length === 0) return;
      const index = visible.findIndex((r) => r.original.id === cursor);
      if (command === "next" || command === "prev") {
        move(command === "next" ? 1 : -1);
      } else if ((command === "open" || command === "edit") && index !== -1) {
        setEditing(visible[index]!.original);
      }
    },
    [visible, cursor, editing, move],
  );
  useShortcut(onShortcut);

  const remember = useFocusRestore(
    container,
    visible.map((r) => r.original.id),
  );
  // The one row in the Tab order: the cursor row, else the first.
  const tabStop = visible.some((r) => r.original.id === cursor) ? cursor : visible[0]?.original.id;

  useEffect(() => {
    container.current
      ?.querySelector<HTMLElement>("[data-cursor='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (rows.length === 0) {
    return (
      <div className="empty">
        <b>All clear</b>
        <span>{emptyMessage}</span>
      </div>
    );
  }

  let lastGroup: string | null = null;
  return (
    <>
      <TableHint
        className="text-right"
        hints={[
          { keys: ["J"], label: "up" },
          { keys: ["K"], label: "down" },
          { keys: ["↵", "E"], label: "edit" },
        ]}
      />
      <div className="tw" ref={container}>
        <div className="tw-tools">
          <label className="cb-row text-[12px] text-ink3">
            <input
              type="checkbox"
              aria-label="Select all tasks"
              checked={table.getIsAllRowsSelected()}
              ref={(el) => {
                if (el) el.indeterminate = table.getIsSomeRowsSelected();
              }}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
            <span>All</span>
          </label>
          <SortSelect columns={TASK_SORT_COLUMNS} sort={sort} />
        </div>
        <div role="table" aria-label="Tasks" data-rt="tasks">
          {table.getHeaderGroups().map((group) => (
            <div
              key={group.id}
              className="tr th"
              role="row"
              style={{ "--cols": COLS } as React.CSSProperties}
            >
              {group.headers.map((header) => {
                const key = SORTABLE[header.column.id];
                return (
                  <span
                    key={header.id}
                    role="columnheader"
                    data-col={header.column.id}
                    aria-sort={key ? ariaSort(sort, key) : undefined}
                  >
                    {key ? (
                      <SortHeader column={sortColumn(key)} sort={sort}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </SortHeader>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </span>
                );
              })}
            </div>
          ))}
          {visible.map((row) => {
            const g = groupOf(row.original);
            const header =
              g !== lastGroup ? (
                <div
                  className={`group-head c-${g === "done" ? "green" : DUE_GROUP_TONE[g]}`}
                  role="row"
                >
                  <span role="rowheader" className="contents">
                    <b>{g === "done" ? "Completed" : DUE_GROUP_LABEL[g]}</b>
                    <span className="n">
                      {visible.filter((r) => groupOf(r.original) === g).length}
                    </span>
                  </span>
                </div>
              ) : null;
            lastGroup = g;
            return (
              <Fragment key={row.id}>
                {header}
                <div
                  className={`tr tb ${isDone(row.original) ? "done" : ""}`}
                  role="row"
                  {...{ [ROW_ID_ATTR]: row.original.id }}
                  tabIndex={row.original.id === tabStop ? 0 : -1}
                  data-cursor={row.original.id === cursor}
                  aria-selected={row.original.id === cursor}
                  style={{ "--cols": COLS } as React.CSSProperties}
                  onFocus={(e) => {
                    remember(row.original.id);
                    if (e.target === e.currentTarget) setCursor(row.original.id);
                  }}
                  onKeyDown={(e) => {
                    rowArrowKeys(e, move);
                    if (e.target === e.currentTarget && e.key === "Enter") {
                      e.preventDefault();
                      setEditing(row.original);
                    }
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a, button, input")) return;
                    setCursor(row.original.id);
                  }}
                  onDoubleClick={() => setEditing(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <span key={cell.id} role="cell" data-col={cell.column.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </span>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      {picked.length ? (
        <div className="bulk-bar" role="group" aria-label="Selected tasks">
          <b className="font-semibold">{picked.length} selected</b>
          <Button
            size="sm"
            disabled={pickedOpen.length === 0}
            title={pickedOpen.length === 0 ? "They are all done already" : undefined}
            onClick={() => void applyBulk({ kind: "done" }, "Marked done")}
          >
            Mark done
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBulkEdit("due")}>
            Set due date
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBulkEdit("priority")}>
            Set priority
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pickedManual.length === 0}
            title={
              pickedManual.length === 0
                ? "Checklist tasks are removed from their checklist"
                : pickedManual.length < picked.length
                  ? "Checklist tasks in the selection are skipped"
                  : undefined
            }
            onClick={() => setDeleting(true)}
          >
            Delete{pickedManual.length ? ` (${pickedManual.length})` : ""}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
            Clear
          </Button>
        </div>
      ) : null}
      {bulkEdit ? (
        <BulkEditDialog
          kind={bulkEdit}
          count={picked.length}
          today={today}
          onClose={() => setBulkEdit(null)}
          onApply={(value) =>
            bulkEdit === "due"
              ? applyBulk(
                  { kind: "due", dueDate: value },
                  value ? "Due date set" : "Due date cleared",
                )
              : applyBulk(
                  { kind: "priority", priority: Number(value) },
                  `Priority set to P${value}`,
                )
          }
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${tasksLabel(pickedManual.length)}?`}
          description={
            pickedManual.length < picked.length
              ? `${tasksLabel(picked.length - pickedManual.length)} from checklists in the selection will be skipped. You can undo this for a few seconds afterwards.`
              : "They will be removed from Tasks. You can undo this for a few seconds afterwards."
          }
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            const result = await removeTasks(pickedManual.map((t) => t.id));
            if (!result.ok) return result.error;
            const { snapshots } = result.data;
            setSelection({});
            router.refresh();
            toast.show({
              text: `Deleted ${tasksLabel(snapshots.length)}`,
              undo: async () => {
                const restored = await undoRemoveTasks(snapshots);
                if (restored.ok) router.refresh();
                return restored;
              },
            });
          }}
        >
          <ul className="m-0 list-none p-0 text-[13px]">
            {pickedManual.slice(0, 8).map((t) => (
              <li key={t.id} className="truncate">
                {t.title}
              </li>
            ))}
            {pickedManual.length > 8 ? (
              <li className="muted">and {pickedManual.length - 8} more</li>
            ) : null}
          </ul>
        </ConfirmDialog>
      ) : null}
      {editing ? (
        <EditTask
          task={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            const saved = editing;
            setEditing(null);
            router.refresh();
            toast.show({ text: `Saved “${saved.title}”` });
          }}
          onDeleted={(snapshot) => {
            setEditing(null);
            router.refresh();
            toast.show({
              text: `Deleted “${snapshot.title}”`,
              undo: async () => {
                const restored = await undoRemoveTask(snapshot);
                if (restored.ok) router.refresh();
                return restored;
              },
            });
          }}
        />
      ) : null}
    </>
  );
}
