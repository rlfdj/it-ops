import { getSessionUser } from "@/lib/auth";
import { getToday } from "@/lib/queries/settings";
import { getAlerts } from "@/lib/queries/alerts";

/**
 * The bell's alerts as JSON. A GET (not a server action) so that reading alerts never
 * queues in front of the user's own saves: server actions run one at a time.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await getAlerts(await getToday()), {
    headers: { "Cache-Control": "no-store" },
  });
}
