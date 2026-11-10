import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { checklists, people } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { OnboardingView } from "@/components/onboarding/onboarding-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The tab and history name the selected checklist, e.g. "Karim Saleh · Offboarding". */
export async function generateMetadata({
  searchParams,
}: PageProps<"/onboarding">): Promise<Metadata> {
  const id = (await searchParams).checklist;
  if (typeof id === "string" && UUID.test(id)) {
    try {
      const [row] = await getDb()
        .select({ name: people.fullName, kind: checklists.kind })
        .from(checklists)
        .innerJoin(people, eq(people.id, checklists.personId))
        .where(eq(checklists.id, id));
      if (row)
        return {
          title: `${row.name} · ${row.kind === "onboarding" ? "Onboarding" : "Offboarding"}`,
        };
    } catch {
      // Fall back to the section name.
    }
  }
  return { title: "On / Offboarding" };
}

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser();
  return <OnboardingView params={await searchParams} />;
}
