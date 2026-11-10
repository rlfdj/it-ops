"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { nextSort, parseSort, sortParam, type Sort, type SortDir } from "@/lib/list-view";

/** Rewrites the current URL's query string; `null` removes a param. Keeps the scroll position. */
function useQueryNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
}

/**
 * The text filter above a list (B-09): a Stock-style field kept in `?q=`, focused by "/".
 * `resetParams` are dropped when the text changes (e.g. the selected record, which may no
 * longer be in the list).
 */
export function ListFilter({
  label,
  placeholder,
  initial,
  resetParams = [],
  className = "",
}: {
  label: string;
  placeholder: string;
  initial: string;
  resetParams?: string[];
  className?: string;
}) {
  const navigate = useQueryNavigation();
  const [value, setValue] = useState(initial);
  // A new URL value (a link, Back) replaces what is typed.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setValue(initial);
  }

  useEffect(() => {
    if (value.trim() === initial) return;
    const timer = setTimeout(() => {
      const patch: Record<string, string | null> = { q: value.trim() || null };
      for (const p of resetParams) patch[p] = null;
      navigate(patch);
    }, 250);
    return () => clearTimeout(timer);
    // `navigate` is rebuilt every render; the typed value and URL value are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, initial]);

  return (
    <label className={`field-wrap flex-[0_1_260px] ${className}`}>
      <SearchIcon size={13} strokeWidth={2} aria-hidden />
      <span className="sr-only">{label}</span>
      <input
        type="text"
        data-filter
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="kbd">/</span>
    </label>
  );
}

export type SortColumn = {
  key: string;
  label: string;
  /** Direction of the first click: newest/biggest first for dates and money. */
  first?: SortDir;
};

/** `aria-sort` for a column header cell. */
export const ariaSort = (sort: Sort | null, key: string) =>
  sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined;

/** A sortable column header: click to sort, again to reverse, a third time to clear. */
export function SortHeader({
  column,
  sort,
  children,
}: {
  column: SortColumn;
  sort: Sort | null;
  children?: React.ReactNode;
}) {
  const navigate = useQueryNavigation();
  const active = sort?.key === column.key ? sort : null;
  return (
    <button
      type="button"
      className="eyebrow inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0"
      onClick={() => navigate({ sort: sortParam(nextSort(sort, column.key, column.first)) })}
    >
      {children ?? column.label}
      {active ? <span aria-hidden>{active.dir === "asc" ? "↓" : "↑"}</span> : null}
    </button>
  );
}

/** The same sorting as a menu, for the narrow layout where column headers are hidden. */
export function SortSelect({ columns, sort }: { columns: SortColumn[]; sort: Sort | null }) {
  const navigate = useQueryNavigation();
  const options = columns.flatMap((c) => {
    const first: SortDir = c.first ?? "asc";
    const second: SortDir = first === "asc" ? "desc" : "asc";
    return [first, second].map((dir) => ({
      value: sortParam({ key: c.key, dir })!,
      label: `${c.label} ${dir === "asc" ? "↓" : "↑"}`,
    }));
  });
  return (
    <label className="inline-flex items-center gap-2 text-[12px] text-ink3">
      Sort
      <select
        className="field"
        value={sortParam(sort) ?? ""}
        onChange={(e) =>
          navigate({
            sort: parseSort(
              e.target.value,
              columns.map((c) => c.key),
            )
              ? e.target.value
              : null,
          })
        }
      >
        <option value="">Default</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
