import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { LockIcon } from "lucide-react";
import { actorName, dayLabel, timeParts } from "@/lib/activity";
import { RANGES, parseActivityParams, type RangeKey } from "@/lib/activity-filters";
import { MONTHS, todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { activityFacets, activityTabCounts, listActivity } from "@/lib/queries/activity";
import { ExportButton } from "@/components/export-button";
import { ViewTabs } from "@/components/view-tabs";
import { ActivitySentence } from "./activity-sentence";
import { DateRange, RecordFilter } from "./activity-controls";

type Params = Record<string, string | string[] | undefined>;
// Events rendered per page; rendering hundreds of sentences at once is slow, so the log
// shows a page at a time with "Show more".
const PAGE = 150;
const MAX = 900;
/** Stored module values shown under their current product name (F038); URL params keep the stored value. */
const moduleLabel = (m: string) => (m === "assets" ? "Stock" : m);

export async function ActivityView({ params }: { params: Params }) {
  const { timeZone } = await getWorkspaceSettings();
  const today = todayIn(timeZone);
  const { range, filters } = parseActivityParams(params, today);
  const requested = Number(Array.isArray(params.limit) ? params.limit[0] : params.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, PAGE), MAX) : PAGE;
  const [entries, facets, tabCounts] = await Promise.all([
    listActivity(filters, limit),
    activityFacets(),
    activityTabCounts(filters, today),
  ]);

  // Query string for links that keep the current filters.
  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && v) base.set(k, v);
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(base);
    // A new filter starts again from the first page.
    if (!("limit" in patch)) q.delete("limit");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return q.size ? `/activity?${q}` : "/activity";
  };
  const rangeHref = (key: RangeKey) =>
    href({ range: key === "7d" ? null : key, from: null, to: null });

  const days = [...Map.groupBy(entries, (e) => timeParts(e.at, timeZone).date)];
  const since = facets.since ? timeParts(facets.since, timeZone).date : null;

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow inline-flex items-center gap-1.5">
            <LockIcon size={11} strokeWidth={2.2} aria-hidden />
            Append-only · {facets.total.toLocaleString("en-US")} events
            {since ? ` since ${MONTHS[Number(since.slice(5, 7)) - 1]} ${since.slice(0, 4)}` : ""}
          </span>
          <h1 className="h1">Activity log</h1>
        </div>
        <div className="right items-center!">
          <RecordFilter key={filters.q ?? ""} initial={filters.q ?? ""} />
          <ExportButton
            href={`/activity/export${base.size ? `?${base}` : ""}`}
            empty={facets.total === 0}
            title="Exports the events matching the filters"
          />
        </div>
      </div>

      <div className="-mt-3 flex flex-col">
        <div className="toolbar fl">
          <span className="lab cap">Module</span>
          <ViewTabs
            label="Module"
            tabs={[
              {
                key: "all",
                label: "All",
                count: [...tabCounts.modules.values()].reduce((n, c) => n + c, 0),
                href: href({ module: null }),
                current: !filters.module,
              },
              ...facets.modules.map((m) => ({
                key: m,
                label: moduleLabel(m),
                count: tabCounts.modules.get(m) ?? 0,
                href: href({ module: m }),
                current: filters.module === m,
              })),
            ]}
          />
        </div>
        <div className="toolbar fl">
          <span className="lab cap">Date</span>
          <ViewTabs
            label="Date"
            tabs={RANGES.map((r) => ({
              key: r.key,
              label: r.label,
              count: tabCounts.ranges[r.key as keyof typeof tabCounts.ranges],
              href: rangeHref(r.key),
              current: range === r.key,
            }))}
          />
          <DateRange
            from={range === "custom" ? (filters.from ?? "") : ""}
            to={range === "custom" ? (filters.to ?? "") : ""}
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <div role="table" aria-label="Activity">
          <div role="row" className="sr-only">
            <span role="columnheader">Time</span>
            <span role="columnheader">Person</span>
            <span role="columnheader">Module</span>
            <span role="columnheader">Event</span>
          </div>
          {days.map(([date, rows]) => (
            <div role="rowgroup" key={date}>
              <div className="group-head" role="row">
                <b role="cell">{dayLabel(date, today)}</b>
                <span role="cell" className="n">
                  {rows.length} {rows.length === 1 ? "event" : "events"}
                </span>
              </div>
              {rows.map((e) => (
                <div
                  key={e.id}
                  className="tr activity-row items-baseline! hover:bg-[var(--sunk)]"
                  role="row"
                  style={{ "--cols": "64px 130px 110px minmax(0, 1fr)" } as React.CSSProperties}
                >
                  <span className="meta contents max-[760px]:flex max-[760px]:gap-2">
                    <span role="cell" className="cap">
                      {timeParts(e.at, timeZone).time}
                    </span>
                    <b role="cell" className="font-semibold">
                      {actorName(e.actor)}
                    </b>
                    <span role="cell" className="cap">
                      {moduleLabel(e.module)}
                    </span>
                  </span>
                  <span role="cell" className="whitespace-normal!">
                    <ActivitySentence entry={e} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        {entries.length === 0 ? (
          <EmptyState
            title="No events match"
            actions={[{ label: "Clear filters", href: "/activity" }]}
          >
            Widen the date range or clear a filter.
          </EmptyState>
        ) : entries.length === limit ? (
          <p className="cap m-0 flex flex-wrap items-center justify-center gap-3 py-4">
            <span>
              Showing the latest {limit}.{" "}
              {limit < MAX ? "" : "Narrow the filters, or export CSV for everything."}
            </span>
            {limit < MAX ? (
              <Link className="btn sm" href={href({ limit: String(limit + PAGE) })} scroll={false}>
                Show more
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </main>
  );
}
