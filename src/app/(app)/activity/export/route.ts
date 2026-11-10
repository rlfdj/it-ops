import type { NextRequest } from "next/server";
import { csvDownload } from "@/lib/csv-response";
import { todayIn } from "@/lib/dates";
import { actorName, describe, sentenceText, timeParts } from "@/lib/activity";
import { parseActivityParams } from "@/lib/activity-filters";
import { listActivity } from "@/lib/queries/activity";
import { personHref, poHref, subscriptionHref } from "@/lib/links";

const links = {
  po: poHref,
  subscription: subscriptionHref,
  checklist: (id: string) => id,
  person: personHref,
};

/** The activity log as CSV, with the same filters as the page (read-only). */
export function GET(request: NextRequest) {
  return csvDownload(request, "activity", async ({ timeZone }) => {
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const { filters } = parseActivityParams(params, todayIn(timeZone));
    const entries = await listActivity(filters, 50_000);
    return {
      header: [
        "Date",
        `Time (${timeZone})`,
        "Actor",
        "Module",
        "Action",
        "Table",
        "Record",
        "Event",
        "Changes",
      ],
      rows: entries.map((e) => {
        const { date, time } = timeParts(e.at, timeZone);
        return [
          date,
          time,
          actorName(e.actor),
          e.module,
          e.action,
          e.tableName,
          e.recordLabel,
          sentenceText(describe(e, links)),
          JSON.stringify(e.changes),
        ];
      }),
    };
  });
}
