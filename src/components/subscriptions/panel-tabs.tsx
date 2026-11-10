"use client";

import { useId, useSyncExternalStore } from "react";

type Tab = "invoices" | "seats";
const KEY = "itops:subscription-tab";
const EVENT = "itops:subscription-tab";

function read(): Tab {
  try {
    return window.localStorage.getItem(KEY) === "seats" ? "seats" : "invoices";
  } catch {
    return "invoices";
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
/** Switch the panel tab (and remember it). */
export function choosePanelTab(tab: Tab) {
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    // Not remembered; the switch still applies.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Invoices and Seats as two tabs in every subscription panel. Invoices opens first; the last tab
 * used is remembered for the next subscription.
 */
export function PanelTabs({
  seatCount,
  invoices,
  seats,
}: {
  /** Active seats, shown on the tab. */
  seatCount: number;
  invoices: React.ReactNode;
  seats: React.ReactNode;
}) {
  const ids = useId();
  const tab = useSyncExternalStore(subscribe, read, () => "invoices" as Tab);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "invoices", label: "Invoices" },
    { id: "seats", label: "Seats", count: seatCount },
  ];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: Tab = tab === "invoices" ? "seats" : "invoices";
    choosePanelTab(next);
    document.getElementById(`${ids}-${next}-tab`)?.focus();
  };

  return (
    <div className="panel-tabs">
      <div className="tabs" role="tablist" aria-label="Subscription detail" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${ids}-${t.id}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${ids}-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => choosePanelTab(t.id)}
          >
            {t.label}
            {t.count != null ? <span className="c">{t.count}</span> : null}
          </button>
        ))}
      </div>
      <div id={`${ids}-${tab}`} role="tabpanel" aria-labelledby={`${ids}-${tab}-tab`} key={tab}>
        {tab === "invoices" ? invoices : seats}
      </div>
    </div>
  );
}
