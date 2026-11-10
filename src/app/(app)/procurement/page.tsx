import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { PO_NUMBER_PATTERN } from "@/lib/ids";
import { ProcurementView } from "@/components/procurement/procurement-view";

/** The tab and history name the selected purchase, e.g. "PO-2026-0159 · Procurement". */
export async function generateMetadata({
  searchParams,
}: PageProps<"/procurement">): Promise<Metadata> {
  const po = (await searchParams).po;
  const number = typeof po === "string" ? po.toUpperCase() : null;
  return {
    title: number && PO_NUMBER_PATTERN.test(number) ? `${number} · Procurement` : "Procurement",
  };
}

export default async function ProcurementPage({ searchParams }: PageProps<"/procurement">) {
  await requireUser();
  return <ProcurementView params={await searchParams} />;
}
