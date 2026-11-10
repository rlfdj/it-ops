"use client";

import { DateField } from "@/components/date-field";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { SearchIcon } from "lucide-react";
import { ColumnChooser } from "@/components/column-chooser";
import { useHiddenColumns } from "@/hooks/use-column-prefs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeleteRecordButton } from "@/components/delete-record";
import { deleteDescription, deleteTitle } from "@/lib/delete-text";
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
import { hasErrors, validateStockItem, without, type FieldErrors } from "@/lib/form-validation";
import { formatShortDate } from "@/lib/format";
import type { StockRow, StockView } from "@/lib/queries/stock";
import {
  checkInStockItems,
  checkOutStockItems,
  retireStockItems,
  removeStockItem,
  saveStockItem,
  saveStockSerial,
} from "@/app/(app)/stock/actions";

// Grid track and minimum width for each column; the grid is built from the visible ones.
const WIDTHS: Record<string, { css: string; min: number }> = {
  select: { css: "34px", min: 34 },
  tag: { css: "100px", min: 100 },
  model: { css: "minmax(120px, 1.2fr)", min: 120 },
  serial: { css: "130px", min: 130 },
  specifications: { css: "minmax(120px, 1.4fr)", min: 120 },
  notes: { css: "minmax(80px, 1fr)", min: 80 },
  added: { css: "72px", min: 72 },
  status: { css: "minmax(110px, 1fr)", min: 110 },
  actions: { css: "168px", min: 168 },
};

/** Columns the chooser can hide (the checkbox, tag and actions always stay). */
const CHOOSABLE = [
  { id: "model", label: "Model" },
  { id: "serial", label: "Serial" },
  { id: "specifications", label: "Specifications" },
  { id: "notes", label: "Notes" },
  { id: "added", label: "Added" },
  { id: "status", label: "Status" },
];

const STATUS_LABEL = { in_stock: "In stock", deployed: "Deployed", retired: "Retired" } as const;

const matches: FilterFn<StockRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const s = row.original;
  return [s.tag, s.model, s.serialNumber, s.specifications, s.notes, s.issuedToName]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(q));
};

/** Serial number, editable in place (click, or E on the selected row). */
type SerialMeta = {
  editingSerial: string | null;
  setEditingSerial: (id: string | null) => void;
};

function SerialCell({
  item,
  editing,
  onEditingChange,
}: {
  item: StockRow;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  // The server's value is the source of truth; `saving` only covers the moment between
  // saving and the refreshed row arriving (the cell can also remount in between).
  const [saving, setSaving] = useState<{ value: string | null } | null>(null);
  const shown = saving ? saving.value : item.serialNumber;
  const [value, setValue] = useState(shown ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    onEditingChange(false);
    const next = value.trim() || null;
    if (next === shown) return;
    setSaving({ value: next });
    const result = await saveStockSerial({ id: item.id, serialNumber: next });
    if (!result.ok) {
      setSaving(null);
      setError(result.error);
    } else {
      setError(null);
      router.refresh();
      const before = shown;
      toast.show({
        text: next ? `Serial for ${item.tag} saved` : `Serial for ${item.tag} cleared`,
        // Writes the old value back; the same value twice is a no-op.
        undo: async () => {
          setSaving({ value: before });
          const undone = await saveStockSerial({ id: item.id, serialNumber: before });
          if (undone.ok) router.refresh();
          else setSaving(null);
          return undone;
        },
      });
    }
  };

  // Drop the optimistic value once the refreshed row carries it.
  if (saving && saving.value === item.serialNumber) setSaving(null);
  // Each edit (click or the E shortcut) starts from what is currently shown.
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setValue(shown ?? "");
  }

  if (editing) {
    return (
      <input
        className="edit id"
        aria-label={`Serial number for ${item.tag}`}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") {
            setValue(shown ?? "");
            onEditingChange(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="cell id text-ink2"
      title="Click to edit"
      aria-label={`Edit serial number for ${item.tag}`}
      onClick={(e) => {
        e.stopPropagation();
        onEditingChange(true);
      }}
    >
      {shown ?? <span className="muted font-sans">Add serial</span>}
      {error ? (
        <span className="field-msg font-sans" role="alert">
          {error}
        </span>
      ) : null}
    </button>
  );
}

const itemsLabel = (items: StockRow[]) =>
  items.length === 1 ? items[0]!.tag : `${items.length} items`;

function TagList({ items }: { items: StockRow[] }) {
  return items.length > 1 ? (
    <p className="m-0 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((i) => (
        <span key={i.id} className="id">
          {i.tag}
        </span>
      ))}
    </p>
  ) : (
    <p className="m-0 text-ink2">{items[0]!.model}</p>
  );
}

/** Check out to a person: who, since when, and a note. The rows stay on the list as Deployed. */
function CheckOutDialog({
  items,
  today,
  people,
  onClose,
  onDone,
}: {
  items: StockRow[];
  today: string;
  people: string[];
  onClose: () => void;
  onDone: (tags: string[]) => void;
}) {
  const ids = useId();
  const [issuedTo, setIssuedTo] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : onClose())}
      title={`Check out ${itemsLabel(items)}`}
      description="The items stay on the stock list as Deployed, so you can see who has them and check them back in."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Checking out…" : "Check out"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const found: FieldErrors = {};
          if (!issuedTo.trim()) found.issuedTo = "Enter who it is issued to.";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(issuedOn)))
            found.issuedOn = "Use a real date.";
          setErrors(found);
          if (hasErrors(found)) return focusFirstInvalid(form);
          setError(null);
          startTransition(async () => {
            const result = await checkOutStockItems({
              ids: items.map((i) => i.id),
              issuedTo,
              issuedOn,
              note,
            });
            if (!result.ok) setError(result.error);
            else onDone(result.data.tags);
          });
        }}
      >
        <TagList items={items} />
        <Field label="Issued to" htmlFor={`${ids}-to`} error={errors.issuedTo}>
          <input
            id={`${ids}-to`}
            className="field"
            list={`${ids}-people`}
            value={issuedTo}
            autoFocus
            autoComplete="off"
            onChange={(e) => {
              setIssuedTo(e.target.value);
              setErrors((all) => without(all, "issuedTo"));
            }}
            {...fieldProps(`${ids}-to`, errors.issuedTo)}
          />
          <datalist id={`${ids}-people`}>
            {people.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        <Field label="Date" htmlFor={`${ids}-on`} error={errors.issuedOn}>
          <DateField
            id={`${ids}-on`}
            className="field"
            value={issuedOn}
            onChange={(e) => {
              setIssuedOn(e.target.value);
              setErrors((all) => without(all, "issuedOn"));
            }}
            {...fieldProps(`${ids}-on`, errors.issuedOn)}
          />
        </Field>
        <Field label="Note (optional)" htmlFor={`${ids}-note`}>
          <input
            id={`${ids}-note`}
            className="field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

/** Check back in (returns to In stock) or retire; both are reversible, so the button is not red. */
function StatusDialog({
  kind,
  items,
  onClose,
  onDone,
}: {
  kind: "in" | "retire";
  items: StockRow[];
  onClose: () => void;
  onDone: (tags: string[]) => void;
}) {
  const checkIn = kind === "in";
  return (
    <ConfirmDialog
      title={`${checkIn ? "Check in" : "Retire"} ${itemsLabel(items)}?`}
      description={
        checkIn
          ? "They return to the In stock list and the issued-to details are cleared."
          : "They stay on the list as Retired and no longer count as in stock. You can check them in again."
      }
      confirmLabel={checkIn ? "Check in" : "Retire"}
      pendingLabel={checkIn ? "Checking in…" : "Retiring…"}
      destructive={false}
      onClose={onClose}
      onConfirm={async () => {
        const ids = items.map((i) => i.id);
        const result = checkIn ? await checkInStockItems({ ids }) : await retireStockItems({ ids });
        if (!result.ok) return result.error;
        onDone(result.data.tags);
      }}
    >
      <TagList items={items} />
    </ConfirmDialog>
  );
}

/** Edit tag, model, serial, specifications and notes (Enter on a row). */
function EditItemDialog({
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  item: StockRow;
  onClose: () => void;
  onSaved: (tag: string) => void;
  onDeleted: () => void;
}) {
  const ids = useId();
  const [tag, setTag] = useState(item.tag);
  const [model, setModel] = useState(item.model);
  const [serialNumber, setSerial] = useState(item.serialNumber ?? "");
  const [specifications, setSpecifications] = useState(item.specifications ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  return (
    <FormDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title={`Edit ${item.tag}`}
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <DeleteRecordButton
            label="Delete item"
            preview={async () => ({
              ok: true,
              data: {
                name: item.tag,
                title: deleteTitle(item.tag),
                description: deleteDescription({
                  deletes: [],
                  keeps: ["To keep it on the list, use Retire instead."],
                }),
              },
            })}
            remove={() => removeStockItem(item.id)}
            onDeleted={onDeleted}
          />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const found = validateStockItem({ tag, model });
          setErrors(found);
          if (hasErrors(found)) return focusFirstInvalid(form);
          setError(null);
          startTransition(async () => {
            const result = await saveStockItem({
              id: item.id,
              tag,
              model,
              serialNumber,
              specifications,
              notes,
            });
            if (!result.ok) {
              // A tag clash belongs on the tag field, not in the footer.
              if (/already in stock/i.test(result.error)) {
                setErrors({ tag: result.error });
                focusFirstInvalid(form);
              } else setError(result.error);
            } else onSaved(tag.trim());
          });
        }}
      >
        <Field label="Tag" htmlFor={`${ids}-tag`} error={errors.tag}>
          <input
            id={`${ids}-tag`}
            className="field font-mono text-[12px]"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setErrors((all) => without(all, "tag"));
            }}
            {...fieldProps(`${ids}-tag`, errors.tag)}
          />
        </Field>
        <Field label="Model" htmlFor={`${ids}-model`} error={errors.model}>
          <input
            id={`${ids}-model`}
            className="field"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setErrors((all) => without(all, "model"));
            }}
            {...fieldProps(`${ids}-model`, errors.model)}
          />
        </Field>
        <Field label="Serial number" htmlFor={`${ids}-serial`}>
          <input
            id={`${ids}-serial`}
            className="field font-mono text-[12px]"
            value={serialNumber}
            onChange={(e) => setSerial(e.target.value)}
          />
        </Field>
        <Field label="Specifications" htmlFor={`${ids}-specs`}>
          <textarea
            id={`${ids}-specs`}
            className="field min-h-[64px] py-2"
            value={specifications}
            onChange={(e) => setSpecifications(e.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor={`${ids}-notes`}>
          <input
            id={`${ids}-notes`}
            className="field"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

export function StockTable({
  rows,
  today,
  view,
  people,
  initialFilter = "",
}: {
  rows: StockRow[];
  today: string;
  view: StockView;
  /** Names to suggest in the check-out dialog. */
  people: string[];
  /** From `?q=` (e.g. a ⌘K search result). */
  initialFilter?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const container = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState(initialFilter);
  const [sorting, setSorting] = useState<SortingState>([{ id: "tag", desc: false }]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [editingSerial, setEditingSerial] = useState<string | null>(null);
  const [editing, setEditing] = useState<StockRow | null>(null);
  const [checkingOut, setCheckingOut] = useState<StockRow[] | null>(null);
  const [checkingIn, setCheckingIn] = useState<StockRow[] | null>(null);
  const [retiring, setRetiring] = useState<StockRow[] | null>(null);
  const { hidden, toggle, reset } = useHiddenColumns("stock");
  // The Status column only exists outside the In stock view.
  const showStatus = view !== "in_stock";
  const chooser = CHOOSABLE.filter((c) => c.id !== "status" || showStatus);
  const columnVisibility: VisibilityState = Object.fromEntries(hidden.map((id) => [id, false]));

  const columns = useMemo<ColumnDef<StockRow>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all"
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
            aria-label={`Select ${row.original.tag}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        id: "tag",
        accessorKey: "tag",
        header: "Tag",
        cell: ({ row }) => <span className="id font-medium">{row.original.tag}</span>,
      },
      {
        id: "model",
        accessorKey: "model",
        header: "Model",
        cell: ({ row }) => <span className="block truncate font-medium">{row.original.model}</span>,
      },
      {
        id: "serial",
        accessorKey: "serialNumber",
        header: "Serial",
        enableSorting: false,
        // Editing state comes through table meta so this cell function stays stable:
        // flexRender treats it as a component, and a new identity would remount the cell.
        cell: ({ row, table }) => {
          const meta = table.options.meta as SerialMeta;
          return (
            <SerialCell
              item={row.original}
              editing={meta.editingSerial === row.original.id}
              onEditingChange={(on) => meta.setEditingSerial(on ? row.original.id : null)}
            />
          );
        },
      },
      {
        id: "specifications",
        accessorKey: "specifications",
        header: "Specifications",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className="block truncate text-ink2"
            title={row.original.specifications ?? undefined}
          >
            {row.original.specifications ?? ""}
          </span>
        ),
      },
      {
        id: "notes",
        accessorKey: "notes",
        header: "Notes",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="muted block truncate" title={row.original.notes ?? undefined}>
            {row.original.notes ?? ""}
          </span>
        ),
      },
      {
        id: "added",
        accessorFn: (s) => s.createdAt.getTime(),
        header: "Added",
        cell: ({ row }) => (
          <span className="muted">
            {formatShortDate(row.original.createdAt.toISOString().slice(0, 10), today)}
          </span>
        ),
      },
      ...(showStatus
        ? [
            {
              id: "status",
              accessorFn: (s: StockRow) => s.status,
              header: "Status",
              cell: ({ row }) => {
                const s = row.original;
                if (s.status !== "deployed")
                  return <span className="muted">{STATUS_LABEL[s.status]}</span>;
                return (
                  <span className="block truncate" title={s.issueNote ?? undefined}>
                    {s.issuedToName}
                    {s.issuedOn ? (
                      <span className="muted"> · {formatShortDate(s.issuedOn, today)}</span>
                    ) : null}
                  </span>
                );
              },
            } satisfies ColumnDef<StockRow>,
          ]
        : []),
      {
        id: "actions",
        enableSorting: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${row.original.tag}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditing(row.original);
              }}
            >
              Edit
            </Button>
            {row.original.status === "in_stock" ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Check out ${row.original.tag}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCheckingOut([row.original]);
                }}
              >
                Check out
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Check in ${row.original.tag}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCheckingIn([row.original]);
                }}
              >
                Check in
              </Button>
            )}
          </span>
        ),
      },
    ],
    [today, showStatus],
  );

  // TanStack Table returns mutable functions; fine without the React Compiler (not enabled).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter: filter, sorting, rowSelection: selection, columnVisibility },
    getRowId: (s) => s.id,
    meta: { editingSerial, setEditingSerial } satisfies SerialMeta,
    onGlobalFilterChange: setFilter,
    onSortingChange: setSorting,
    onRowSelectionChange: setSelection,
    globalFilterFn: matches,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visible = table.getRowModel().rows;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedIn = selected.filter((s) => s.status === "in_stock");
  const selectedAway = selected.filter((s) => s.status !== "in_stock");
  const leaf = table.getVisibleLeafColumns().map((c) => WIDTHS[c.id]!);
  const cols = leaf.map((w) => w.css).join(" ");

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
      if (visible.length === 0 || editing || checkingOut || checkingIn || retiring) return;
      const index = visible.findIndex((r) => r.original.id === cursor);
      if (command === "next" || command === "prev") {
        move(command === "next" ? 1 : -1);
      } else if (command === "open" && index !== -1) {
        setEditing(visible[index]!.original);
      } else if (command === "edit" && index !== -1) {
        setEditingSerial(visible[index]!.original.id);
      } else if (command === "close") {
        setEditingSerial(null);
      }
    },
    [visible, cursor, editing, checkingOut, checkingIn, retiring, move],
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

  const afterEdit = (tag: string) => {
    setEditing(null);
    router.refresh();
    toast.show({ text: `Saved ${tag}` });
  };
  const afterStatus = (verb: string) => (tags: string[]) => {
    setCheckingOut(null);
    setCheckingIn(null);
    setRetiring(null);
    setSelection({});
    router.refresh();
    toast.show({
      text:
        tags.length === 1
          ? `${verb} ${tags[0]}`
          : `${verb} ${tags.length} items (${tags.slice(0, 3).join(", ")}${tags.length > 3 ? ", …" : ""})`,
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="field-wrap flex-[0_1_260px]">
          <SearchIcon size={13} strokeWidth={2} aria-hidden />
          <span className="sr-only">Filter stock</span>
          <input
            type="text"
            data-filter
            placeholder="Tag, model, serial, specs or note"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
          />
          <span className="kbd">/</span>
        </label>
        <span className="ml-auto flex items-center gap-3">
          <ColumnChooser columns={chooser} hidden={hidden} onToggle={toggle} onReset={reset} />
        </span>
        <TableHint
          hints={[
            { keys: ["J"], label: "up" },
            { keys: ["K"], label: "down" },
            { keys: ["↵"], label: "edit" },
            { keys: ["E"], label: "serial" },
          ]}
        />
      </div>

      <div className="tw" ref={container}>
        <div className="tw-tools">
          <label className="cb-row text-[12px] text-ink3">
            <input
              type="checkbox"
              aria-label="Select all"
              checked={table.getIsAllRowsSelected()}
              ref={(el) => {
                if (el) el.indeterminate = table.getIsSomeRowsSelected();
              }}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
            <span>All</span>
          </label>
          <label className="inline-flex items-center gap-2 text-[12px] text-ink3">
            Sort
            <select
              className="field"
              value={
                sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : "tag:asc"
              }
              onChange={(e) => {
                const [id, dir] = e.target.value.split(":");
                setSorting([{ id: id!, desc: dir === "desc" }]);
              }}
            >
              <option value="tag:asc">Tag ↓</option>
              <option value="tag:desc">Tag ↑</option>
              <option value="model:asc">Model ↓</option>
              <option value="model:desc">Model ↑</option>
              <option value="added:desc">Newest added</option>
              <option value="added:asc">Oldest added</option>
            </select>
          </label>
        </div>
        <div
          role="table"
          aria-label="Stock"
          data-rt="stock"
          data-wide={showStatus ? "" : undefined}
        >
          {table.getHeaderGroups().map((group) => (
            <div
              key={group.id}
              className="tr th"
              role="row"
              style={{ "--cols": cols } as React.CSSProperties}
            >
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <span
                    key={header.id}
                    role="columnheader"
                    data-col={header.column.id}
                    aria-sort={sorted ? (sorted === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className="eyebrow inline-flex items-center gap-1 border-0 bg-transparent p-0"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted ? <span aria-hidden>{sorted === "asc" ? "↓" : "↑"}</span> : null}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </span>
                );
              })}
            </div>
          ))}
          {visible.map((row) => (
            <div
              key={row.id}
              className="tr tb"
              role="row"
              {...{ [ROW_ID_ATTR]: row.original.id }}
              tabIndex={row.original.id === tabStop ? 0 : -1}
              data-cursor={row.original.id === cursor}
              aria-selected={row.getIsSelected() || row.original.id === cursor}
              style={{ "--cols": cols } as React.CSSProperties}
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
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="empty">
            <b>Nothing matches</b>
            <span>Try a different tag, model, serial or note.</span>
            {filter ? (
              <div className="actions">
                <Button size="sm" onClick={() => setFilter("")}>
                  Clear filter
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-between gap-3 text-[12px] text-ink3">
        <span>
          Showing {visible.length} of {rows.length}
        </span>
        {selected.length ? (
          <span className="flex items-center gap-2 text-ink">
            <b className="font-semibold">{selected.length} selected</b>
            {selectedIn.length ? (
              <Button size="sm" onClick={() => setCheckingOut(selectedIn)}>
                Check out
              </Button>
            ) : null}
            {selectedIn.length ? (
              <Button size="sm" variant="ghost" onClick={() => setRetiring(selectedIn)}>
                Retire
              </Button>
            ) : null}
            {selectedAway.length ? (
              <Button size="sm" onClick={() => setCheckingIn(selectedAway)}>
                Check in
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
              Clear
            </Button>
          </span>
        ) : null}
      </div>

      {checkingOut ? (
        <CheckOutDialog
          items={checkingOut}
          today={today}
          people={people}
          onClose={() => setCheckingOut(null)}
          onDone={afterStatus("Checked out")}
        />
      ) : null}
      {checkingIn ? (
        <StatusDialog
          kind="in"
          items={checkingIn}
          onClose={() => setCheckingIn(null)}
          onDone={afterStatus("Checked in")}
        />
      ) : null}
      {retiring ? (
        <StatusDialog
          kind="retire"
          items={retiring}
          onClose={() => setRetiring(null)}
          onDone={afterStatus("Retired")}
        />
      ) : null}
      {editing ? (
        <EditItemDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={afterEdit}
          onDeleted={() => {
            setEditing(null);
            setSelection({});
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
