import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { csvDownload } from "@/lib/csv-response";
import { listSeats } from "@/lib/queries/seats";
import { SEAT_TIER_LABEL } from "@/lib/subscription-seats";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE = {
  manual: "Added by hand",
  prorated: "Pro-rated invoice",
  import: "Import",
} as const;

/** The seat roster of one subscription (`?sub=<id>`): everyone holding a seat now. */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("sub") ?? "";
  if (!UUID.test(id)) return new NextResponse("Unknown subscription.", { status: 404 });
  const [sub] = await getDb()
    .select({ name: subscriptions.name })
    .from(subscriptions)
    .where(eq(subscriptions.id, id));
  if (!sub) return new NextResponse("Unknown subscription.", { status: 404 });
  const slug = sub.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return csvDownload(request, `${slug || "subscription"}-seats`, async () => {
    const seats = await listSeats(id);
    return {
      header: ["Person", "Seat", "Project", "Source"],
      rows: seats
        .filter((s) => s.until === null)
        .map((s) => [s.personName, SEAT_TIER_LABEL[s.tier], s.project, SOURCE[s.source]]),
    };
  });
}
