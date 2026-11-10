"use client";

import { EmptyState } from "@/components/empty-state";
import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "@/components/link";
import { useRouter } from "next/navigation";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Aed } from "@/components/aed";
import { ariaSort, SortHeader, SortSelect } from "@/components/list-controls";
import type { Sort } from "@/lib/list-view";
import { SUB_SORT_COLUMNS } from "@/lib/list-sorts";
import { openDetail, sheetIsOpen } from "@/components/detail-sheet";
import { TableHint } from "@/components/table-hint";
import { useShortcut, type ShortcutCommand } from "@/hooks/use-shortcut";
import { focusRow, ROW_ID_ATTR, rowArrowKeys, stepIndex } from "@/hooks/use-row-focus";

export type SubTableRow = {
  id: string;
  name: string;
  detail: string;
  /** The latest on-file renewal invoice: amount and date; null when none yet. */
  lastPaid: { aed: number; date: string; title: string } | null;
  nextDate: string;
  nextLeft: string;
  nextTitle?: string;
  tone: "red" | "amber" | "grey";
  invoiceText: string;
  invoiceState: "on_file" | "missing" | "upcoming";
  inactive: boolean;
};

// Below ~600px of table width the rows collapse to two lines (see [data-rt="subs"] in globals.css).
const COLS = "minmax(200px, 1.6fr) 128px 112px 112px";
const SORTABLE: Record<string, string> = { name: "name", paid: "paid", next: "next" };
const sortColumn = (key: string) => SUB_SORT_COLUMNS.find((c) => c.key === key)!;

export function SubsTable({
  rows,
  selected,
  query,
  sort,
}: {
  rows: SubTableRow[];
  sort: Sort | null;
  selected: string | null;
  /** Current filter query string, without `sub`. */
  query: string;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const href = useCallback(
    (id: string) => {
      const params = new URLSearchParams(query);
      params.set("sub", id);
      return `/subscriptions?${params}`;
    },
    [query],
  );

  const select = useCallback((id: string) => openDetail(router, "sub", href(id)), [router, href]);

  const columns = useMemo<ColumnDef<SubTableRow>[]>(
    () => [
      {
        id: "name",
        header: "Subscription",
        cell: ({ row: { original: r } }) => (
          <Link
            href={href(r.id)}
            replace
            scroll={false}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              select(r.id);
            }}
            className="pick"
            // The row is the keyboard stop (Enter selects it); a second stop per row is noise.
            tabIndex={-1}
          >
            <span className={`nm truncate font-semibold ${r.inactive ? "text-ink3" : "text-ink"}`}>
              {r.name}
            </span>
            <span className="muted truncate text-[12px]">{r.detail}</span>
          </Link>
        ),
      },
      {
        id: "paid",
        header: () => <span className="text-right">Last paid</span>,
        cell: ({ row: { original: r } }) =>
          r.lastPaid ? (
            <span className="flex flex-col items-end gap-px" title={r.lastPaid.title}>
              <Aed value={r.lastPaid.aed} className="font-medium" />
              <span className="muted text-[12px]">{r.lastPaid.date}</span>
            </span>
          ) : (
            <span className="muted flex flex-col items-end text-[12px]">No invoice yet</span>
          ),
      },
      {
        id: "next",
        header: "Next",
        cell: ({ row: { original: r } }) => (
          <span className="flex flex-col gap-px" title={r.nextTitle}>
            <span>{r.nextDate}</span>
            {r.nextLeft ? <span className={`st c-${r.tone} text-[12px]`}>{r.nextLeft}</span> : null}
          </span>
        ),
      },
      {
        id: "invoices",
        header: "Invoices",
        cell: ({ row: { original: r } }) => (
          <span
            className={`mark ${r.invoiceState === "on_file" ? "ok" : r.invoiceState === "missing" ? "miss" : "up"}`}
          >
            {r.invoiceText}
          </span>
        ),
      },
    ],
    [href, select],
  );

  // TanStack Table returns mutable functions; fine without the React Compiler (not enabled).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
  });

  // Moving selects the row (the panel follows) and moves DOM focus with it.
  const move = useCallback(
    (step: -1 | 1 | "first" | "last") => {
      const index = rows.findIndex((r) => r.id === selected);
      const next = rows[stepIndex(index, rows.length, step)];
      if (!next) return;
      select(next.id);
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
  const tabStop = rows.some((r) => r.id === selected) ? selected : rows[0]?.id;

  useEffect(() => {
    container.current
      ?.querySelector<HTMLElement>("[aria-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing matches"
        actions={[{ label: "Clear filters", href: "/subscriptions" }]}
      >
        Try a different kind, or clear the filter.
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
      <div ref={container} className="tw">
        <div className="tw-tools">
          <SortSelect columns={SUB_SORT_COLUMNS} sort={sort} />
        </div>
        <div role="table" aria-label="Subscriptions" data-rt="subs">
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
                    className={header.column.id === "paid" ? "r" : undefined}
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
              tabIndex={row.original.id === tabStop ? 0 : -1}
              aria-selected={row.original.id === selected}
              style={{ "--cols": COLS } as React.CSSProperties}
              onKeyDown={(e) => {
                rowArrowKeys(e, move);
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  select(row.original.id);
                }
              }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) return;
                select(row.original.id);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <span key={cell.id} role="cell" data-col={cell.column.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
