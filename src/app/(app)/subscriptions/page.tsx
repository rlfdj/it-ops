import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SubscriptionsView } from "@/components/subscriptions/subscriptions-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tab and history name the selected subscription, e.g. "Microsoft 365 · Subscriptions". */
export async function generateMetadata({
  searchParams,
}: PageProps<"/subscriptions">): Promise<Metadata> {
  const sub = (await searchParams).sub;
  if (typeof sub === "string" && UUID.test(sub)) {
    try {
      const [row] = await getDb()
        .select({ name: subscriptions.name })
        .from(subscriptions)
        .where(eq(subscriptions.id, sub));
      if (row) return { title: `${row.name} · Subscriptions` };
    } catch {
      // The title is a nicety; fall back to the section name.
    }
  }
  return { title: "Subscriptions" };
}

export default async function SubscriptionsPage({ searchParams }: PageProps<"/subscriptions">) {
  await requireUser();
  return <SubscriptionsView params={await searchParams} />;
}
