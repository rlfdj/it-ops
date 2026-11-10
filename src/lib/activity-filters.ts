import { addDays } from "./dates.ts";

export type RangeKey = "today" | "7d" | "30d" | "all" | "custom";

export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All" },
];

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

/** Reads the Activity log filters from the URL (shared by the page and the CSV export). */
export function parseActivityParams(params: Params, today: string) {
  const from = one(params.from);
  const to = one(params.to);
  const rangeParam = one(params.range) as RangeKey | undefined;
  const range: RangeKey =
    isDate(from) || isDate(to)
      ? "custom"
      : rangeParam && ["today", "7d", "30d", "all"].includes(rangeParam)
        ? rangeParam
        : "7d";
  const window =
    range === "custom"
      ? { from: isDate(from) ? from : null, to: isDate(to) ? to : null }
      : range === "today"
        ? { from: today, to: today }
        : range === "7d"
          ? { from: addDays(today, -6), to: today }
          : range === "30d"
            ? { from: addDays(today, -29), to: today }
            : { from: null, to: null };
  const q = one(params.q)?.trim() || one(params.record)?.trim() || null;
  return {
    range,
    filters: {
      module: one(params.module) || null,
      from: window.from,
      to: window.to,
      q,
    },
  };
}
