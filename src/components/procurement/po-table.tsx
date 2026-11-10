"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from "@tanstack/react-table";
import { Aed } from "@/components/aed";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/shell/toast";
import { ariaSort, SortHeader, SortSelect } from "@/components/list-controls";
import type { Sort } from "@/lib/list-view";
import { PO_SORT_COLUMNS } from "@/lib/list-sorts";
import { closePurchaseOrders, undoClosePurchaseOrders } from "@/app/(app)/procurement/actions";
import { TableHint } from "@/components/table-hint";
import { useShortcut, type ShortcutCommand } from "@/hooks/use-shortcut";
import { focusRow, ROW_ID_ATTR, rowArrowKeys, stepIndex } from "@/hooks/use-row-focus";
import { DOC_LABEL, DOC_SHORT } from "@/lib/procurement";
import type { PoListRow } from "@/lib/queries/procurement";
import { procurementHref } from "@/lib/links";
import { openDetail, sheetIsOpen } from "@/components/detail-sheet";
import { StageStatus } from "./stage-status";

// Below ~580px of table width the rows collapse to PO / vendor / chips lines (see
// [data-rt="po"] in globals.css), so no column is ever scrolled out of view (B-06).
const COLS = "34px 98px minmax(120px, 1fr) 108px 100px 124px";
const SORTABLE: Record<string, string> = {
  po: "requested",
  vendor: "vendor",
  amount: "amount",
  status: "status",
};
const sortColumn = (key: string) => PO_SORT_COLUMNS.find((c) => c.key === key)!;

const DOC_STATE_TEXT = { ok: "attached", miss: "missing", na: "not needed yet" } as const;

export function PoTable({
  rows,
  selected,
  query,
  dates,
  sort,
  filtered,
  hasAny,
}: {
  rows: PoListRow[];
  selected: string | null;
  /** Current tab/filter query string, without `po`. */
  query: string;
  /** Pre-formatted requested dates keyed by PO number. */
  dates: Record<string, string>;
  sort: Sort | null;
  /** A text or "missing" filter is active. */
  filtered: boolean;
  /** There are purchases at all (so an empty list is the filter's doing). */
  hasAny: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [closing, setClosing] = useState<PoListRow[] | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const select = useCallback(
    (poNumber: string) => openDetail(router, "po", procurementHref(query, poNumber)),
    [router, query],
  );

  const columns = useMemo<ColumnDef<PoListRow>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all purchases"
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
            aria-label={`Select ${row.original.poNumber}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        id: "po",
        header: "PO",
        cell: ({ row: { original: p } }) => (
          <>
            <Link
              href={procurementHref(query, p.poNumber)}
              scroll={false}
              replace
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                select(p.poNumber);
              }}
              className="lnk"
              // The row is the keyboard stop (Enter selects it); a second stop per row is noise.
              tabIndex={-1}
            >
              {p.poNumber}
            </Link>
            <span className="sub">{dates[p.poNumber]}</span>
          </>
        ),
      },
      {
        id: "vendor",
        header: "Vendor · items",
        cell: ({ row: { original: p } }) => (
          <>
            <span className="rec t">{p.vendor}</span>
            <span className="sub" title={p.summary}>
              {p.summary}
            </span>
          </>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        cell: ({ row: { original: p } }) => <Aed value={p.totalAed} className="fw-500" />,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row: { original: p } }) => <StageStatus stage={p.status} />,
      },
      {
        id: "docs",
        header: "Documents",
        cell: ({ row: { original: p } }) => (
          <span className="docs">
            {p.docs.map((d) => (
              <span
                key={d.kind}
                className={`mark code ${d.state}`}
                title={`${DOC_LABEL[d.kind]}: ${DOC_STATE_TEXT[d.state]}`}
              >
                {DOC_SHORT[d.kind]}
              </span>
            ))}
          </span>
        ),
      },
    ],
    [query, dates, select],
  );

  // TanStack Table returns mutable functions; fine without the React Compiler (not enabled).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
    getRowId: (p) => p.id,
    getCoreRowModel: getCoreRowModel(),
  });
  const picked = rows.filter((r) => selection[r.id]);
  const pickedDelivered = picked.filter((r) => r.status === "delivered");

  // Moving selects the row (the panel follows) and moves DOM focus with it.
  const move = useCallback(
    (step: -1 | 1 | "first" | "last") => {
      const index = rows.findIndex((r) => r.poNumber === selected);
      const next = rows[stepIndex(index, rows.length, step)];
      if (!next) return;
      select(next.poNumber);
      // The sheet keeps focus while it is open.
      if (!sheetIsOpen()) focusRow(container.current, next.id);
    },
    [rows, selected, select],
  );

  const onShortcut = useCallback(
    (command: ShortcutCommand) => {
      if (command !== "next" && command !== "prev") return;
      move(command === "next" ? 1 : -1);
    },
    [move],
  );
  useShortcut(onShortcut);

  // The one row in the Tab order: the selected row, else the first.
  const tabStop = rows.some((r) => r.poNumber === selected) ? selected : rows[0]?.poNumber;

  // Keep the selected row in view when moving with J / K.
  useEffect(() => {
    container.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title={hasAny ? "Nothing here" : "No purchases yet"}
        actions={
          hasAny
            ? [{ label: "Show all purchases", href: "/procurement" }]
            : [{ label: "New purchase", href: "/procurement?new=1", primary: true }]
        }
      >
        {hasAny
          ? filtered
            ? "No purchases match this stage and filter."
            : "No purchases at this stage."
          : "Log a purchase to track its approval, delivery note and invoice."}
      </EmptyState>
    );
  }

  return (
    <>
      <TableHint
        className="text-right"
        hints={[
          { keys: ["J"], label: "up" },
          { keys: ["K"], label: "down" },
          { keys: ["E"], label: "edit" },
        ]}
      />
      <div className="tw" ref={container}>
        <div className="tw-tools">
          <label className="cb-row text-[12px] text-ink3">
            <input
              type="checkbox"
              aria-label="Select all purchases"
              checked={table.getIsAllRowsSelected()}
              ref={(el) => {
                if (el) el.indeterminate = table.getIsSomeRowsSelected();
              }}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
            <span>All</span>
          </label>
          <SortSelect columns={PO_SORT_COLUMNS} sort={sort} />
        </div>
        <div role="table" aria-label="Purchase orders" data-rt="po">
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
                    className={header.column.id === "amount" ? "r" : undefined}
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
          {table.getRowModel().rows.map((row) => (
            <div
              key={row.id}
              className="tr tb lg"
              role="row"
              {...{ [ROW_ID_ATTR]: row.original.id }}
              tabIndex={row.original.poNumber === tabStop ? 0 : -1}
              aria-selected={row.original.poNumber === selected}
              style={{ "--cols": COLS } as React.CSSProperties}
              onKeyDown={(e) => {
                rowArrowKeys(e, move);
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  select(row.original.poNumber);
                }
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a, input")) return;
                select(row.original.poNumber);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <span
                  key={cell.id}
                  role="cell"
                  data-col={cell.column.id}
                  className={cell.column.id === "amount" ? "r" : undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      {picked.length ? (
        <div className="bulk-bar" role="group" aria-label="Selected purchases">
          <b className="font-semibold">{picked.length} selected</b>
          <Button
            size="sm"
            disabled={pickedDelivered.length === 0}
            title={
              pickedDelivered.length === 0
                ? "Only delivered purchases can be closed"
                : pickedDelivered.length < picked.length
                  ? `Closes the ${pickedDelivered.length} delivered; the others are left as they are`
                  : undefined
            }
            onClick={() => setClosing(pickedDelivered)}
          >
            Close delivered{pickedDelivered.length ? ` (${pickedDelivered.length})` : ""}
          </Button>
          <a
            className="btn sm"
            download
            href={`/procurement/export?po=${picked.map((p) => encodeURIComponent(p.poNumber)).join(",")}`}
          >
            Export selected
          </a>
          <Button size="sm" variant="ghost" onClick={() => setSelection({})}>
            Clear
          </Button>
        </div>
      ) : null}
      {closing ? (
        <ConfirmDialog
          title={`Close ${closing.length === 1 ? closing[0]!.poNumber : `${closing.length} purchases`}?`}
          description="Closed purchases leave the open value. You can undo this for a few seconds afterwards."
          confirmLabel="Close purchases"
          pendingLabel="Closing…"
          destructive={false}
          onClose={() => setClosing(null)}
          onConfirm={async () => {
            const poIds = closing.map((p) => p.id);
            const result = await closePurchaseOrders({ poIds });
            if (!result.ok) return result.error;
            setClosing(null);
            setSelection({});
            router.refresh();
            const numbers = result.data.poNumbers;
            toast.show({
              text:
                numbers.length === 1
                  ? `Closed ${numbers[0]}`
                  : `Closed ${numbers.length} purchases (${numbers.slice(0, 3).join(", ")}${numbers.length > 3 ? ", …" : ""})`,
              undo: async () => {
                const undone = await undoClosePurchaseOrders({ poIds });
                if (undone.ok) router.refresh();
                return undone;
              },
            });
          }}
        >
          <ul className="m-0 list-none p-0 text-[13px]">
            {closing.slice(0, 8).map((p) => (
              <li key={p.id}>
                <span className="mono">{p.poNumber}</span> · {p.vendor}
              </li>
            ))}
            {closing.length > 8 ? <li className="muted">and {closing.length - 8} more</li> : null}
          </ul>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
