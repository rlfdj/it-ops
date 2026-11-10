import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { toCsv } from "@/lib/csv";

type Cell = string | number | null | undefined;

/**
 * A signed-in CSV download, named `itops-<name>-<today>.csv`. Signed-out requests go
 * to the login page.
 */
export async function csvDownload(
  request: NextRequest,
  name: string,
  build: (workspace: {
    timeZone: string;
    currency: string;
  }) => Promise<{ header: string[]; rows: Cell[][] }>,
) {
  if (!(await getSessionUser()))
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  const { timeZone, baseCurrency } = await getWorkspaceSettings();
  const { header, rows } = await build({ timeZone, currency: baseCurrency });
  return new NextResponse(toCsv(header, rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="itops-${name}-${todayIn(timeZone)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
