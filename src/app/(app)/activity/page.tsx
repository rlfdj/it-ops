import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ActivityView } from "@/components/activity/activity-view";

export const metadata: Metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await requireUser();
  return <ActivityView params={await searchParams} />;
}
