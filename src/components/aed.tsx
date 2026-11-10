"use client";

import { formatMoney } from "@/lib/format";
import { useWorkspace } from "@/components/workspace-context";

/**
 * A base-currency amount: small grey currency code (the workspace base currency from
 * Settings), then the figure with tabular numbers. Component name kept from when the base
 * was always AED.
 */
export function Aed({ value, className }: { value: number; className?: string }) {
  const { baseCurrency } = useWorkspace();
  return (
    <span className={className}>
      <span className="cur">{baseCurrency}</span>
      {formatMoney(value)}
    </span>
  );
}

/** The workspace base currency code as text ("AED", "EUR", …), for labels and headers. */
export function BaseCurrency() {
  return <>{useWorkspace().baseCurrency}</>;
}
