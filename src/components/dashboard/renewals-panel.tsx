"use client";

import { useState } from "react";
import Link from "@/components/link";
import { MONTHS, daysBetween } from "@/lib/dates";
import { RENEWAL_WINDOWS, expectedTotal, inWindow, type RenewalWindow } from "@/lib/dashboard";
import { formatMoney } from "@/lib/format";
import { useWorkspace } from "@/components/workspace-context";
import { relativeDays } from "@/lib/subscriptions";
import { subscriptionHref } from "@/lib/links";
import type { Renewal } from "@/lib/queries/dashboard";

/** Renewals in the next 30 / 60 / 90 days with the window total. */
export function RenewalsPanel({ renewals, today }: { renewals: Renewal[]; today: string }) {
  const { baseCurrency } = useWorkspace();
  const [win, setWin] = useState<RenewalWindow>(30);
  const list = inWindow(renewals, today, win);
  const total = expectedTotal(list);

  return (
    <section aria-label="Upcoming renewals" className="flex min-w-0 flex-col">
      <div className="sec-head">
        <div className="lead">
          <h2 className="h2">Upcoming renewals</h2>
        </div>
        <div className="seg" role="group" aria-label="Window">
          {RENEWAL_WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={w === win} onClick={() => setWin(w)}>
              {w} days
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col">
        {list.map((r) => {
          const days = daysBetween(today, r.due);
          return (
            <div key={r.id} className="rn">
              <div className="dm">
                <b>{r.due.slice(8, 10)}</b>
                <span>{MONTHS[Number(r.due.slice(5, 7)) - 1]}</span>
              </div>
              <div className="min-w-0">
                <Link href={subscriptionHref(r.id)} className="rec block truncate font-medium">
                  {r.name}
                </Link>
                <span className="meta block">
                  {r.vendor} ·{" "}
                  {r.kind === "contract"
                    ? "Contract end"
                    : r.cycle === "yearly"
                      ? "Annual renewal"
                      : "Monthly charge"}{" "}
                  · {r.autoRenew ? "Auto-renew" : "Manual"}
                </span>
              </div>
              <div className="amt flex flex-col items-end gap-0.5">
                <b>
                  {r.costAed == null ? (
                    "—"
                  ) : (
                    <>
                      <span className="cur">{baseCurrency}</span>
                      {formatMoney(r.costAed)}
                    </>
                  )}
                </b>
                <span className={`st c-${r.tone} text-[12px]`}>{relativeDays(days)}</span>
              </div>
            </div>
          );
        })}
        {list.length === 0 ? (
          <p className="cap m-0 py-4">Nothing renews in the next {win} days.</p>
        ) : null}
      </div>
      <div className="rn-foot">
        <span>
          {list.length} {list.length === 1 ? "item" : "items"} in the next {win} days
        </span>
        {total === null ? null : (
          <b title="Sum of the expected costs; renewals without one are left out">
            <span className="cur">{baseCurrency}</span>
            {formatMoney(total)} expected
          </b>
        )}
      </div>
    </section>
  );
}
