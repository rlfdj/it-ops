import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { StockView } from "@/components/stock/stock-view";

export const metadata: Metadata = { title: "Stock" };

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  await requireUser();
  return <StockView params={await searchParams} />;
}
