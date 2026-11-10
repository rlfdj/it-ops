// Sorting and text filtering for the list screens (B-09). Pure functions: the screens keep
// `?sort=` and `?q=` in the URL, so links, exports and reloads all share one view.

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };

/** `?sort=amount` is ascending, `?sort=-amount` descending; unknown keys mean "no sort". */
export function parseSort(raw: string | undefined, allowed: readonly string[]): Sort | null {
  if (!raw) return null;
  const desc = raw.startsWith("-");
  const key = desc ? raw.slice(1) : raw;
  return allowed.includes(key) ? { key, dir: desc ? "desc" : "asc" } : null;
}

export const sortParam = (sort: Sort | null): string | null =>
  sort ? `${sort.dir === "desc" ? "-" : ""}${sort.key}` : null;

/** Header click: unsorted → `first` → the opposite → unsorted again. */
export function nextSort(current: Sort | null, key: string, first: SortDir = "asc"): Sort | null {
  if (!current || current.key !== key) return { key, dir: first };
  if (current.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

type Value = string | number | null | undefined;

/** Sorts a copy of `rows` by the chosen column. Empty values go last either way; ties keep their order. */
export function sortRows<T>(
  rows: T[],
  sort: Sort | null,
  getters: Record<string, (row: T) => Value>,
): T[] {
  const get = sort ? getters[sort.key] : undefined;
  if (!sort || !get) return rows;
  const sign = sort.dir === "desc" ? -1 : 1;
  const empty = (v: Value) => v === null || v === undefined || v === "";
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((a, b) => {
      if (empty(a.value) || empty(b.value)) {
        if (empty(a.value) && empty(b.value)) return a.index - b.index;
        return empty(a.value) ? 1 : -1;
      }
      const diff =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : String(a.value).localeCompare(String(b.value), "en", { numeric: true });
      return diff ? diff * sign : a.index - b.index;
    })
    .map((x) => x.row);
}

/** True when every word of `query` appears (case-insensitive) in one of the fields. */
export function matchesQuery(query: string, fields: Value[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fields
    .filter((f) => f !== null && f !== undefined)
    .join("\n")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export const filterRows = <T>(rows: T[], query: string, fields: (row: T) => Value[]): T[] =>
  query.trim() ? rows.filter((r) => matchesQuery(query, fields(r))) : rows;

/** A search param as a single trimmed string. */
export function textParam(v: string | string[] | undefined): string {
  return ((Array.isArray(v) ? v[0] : v) ?? "").trim().slice(0, 200);
}
