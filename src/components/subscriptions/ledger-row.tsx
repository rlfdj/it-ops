"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { SEAT_TIER_LABEL, type SeatTier } from "@/lib/subscription-seats";

type Seat = { personName: string; tier: SeatTier; project: string | null };

/**
 * One row of the invoice ledger (the five fixed `.ledger-row` columns). A pro-rated row
 * passes its seats: the period cell then becomes a ▸ toggle (also clickable anywhere on the
 * row) that opens a small Person | Seat | Project table under the line.
 */
export function LedgerRow({
  label,
  detail,
  amount,
  status,
  acts,
  seats,
}: {
  /** The period cell's text, e.g. "Sep ’26" or "Pro-rated · 14 Oct". */
  label: string;
  detail: ReactNode;
  amount: ReactNode;
  status: ReactNode;
  acts: ReactNode;
  /** Pro-rated rows with seats are expandable. */
  seats?: Seat[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const expandable = Boolean(seats?.length);
  return (
    <Fragment>
      <div
        role="row"
        className={`ledger-row${expandable ? " expandable" : ""}${open ? " open" : ""}`}
        onClick={
          expandable
            ? (e) => {
                if ((e.target as HTMLElement).closest("button, a, input, label")) return;
                setOpen((o) => !o);
              }
            : undefined
        }
      >
        <span role="cell" className="font-medium">
          {expandable ? (
            <button
              type="button"
              className="ledger-toggle"
              aria-expanded={open}
              aria-controls={panelId}
              title={open ? "Hide the seats" : "Show the seats"}
              onClick={() => setOpen((o) => !o)}
            >
              <span className="caret" aria-hidden>
                ▸
              </span>
              <span className="truncate">{label}</span>
            </button>
          ) : (
            label
          )}
        </span>
        <span role="cell" className="id muted truncate">
          {detail}
        </span>
        <span role="cell" className="flex flex-col items-end">
          {amount}
        </span>
        <span role="cell">{status}</span>
        <span role="cell" className="acts">
          {acts}
        </span>
      </div>
      {expandable && open ? (
        <div role="row" id={panelId} className="ledger-seats">
          <div role="cell">
            <table aria-label={`Seats on the ${label} invoice`}>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Seat</th>
                  <th scope="col">Project</th>
                </tr>
              </thead>
              <tbody>
                {seats!.map((s, i) => (
                  <tr key={i}>
                    <td>{s.personName}</td>
                    <td>{SEAT_TIER_LABEL[s.tier]}</td>
                    <td>{s.project || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Fragment>
  );
}
