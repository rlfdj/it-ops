"use client";

import { useCallback, useSyncExternalStore } from "react";

// Which columns a table shows, remembered per table in localStorage (B-39). Storage can be
// missing or blocked (private window), so every access is wrapped and the table falls back
// to showing every column. Only the hidden column ids are stored.

const EVENT = "app:column-prefs";
const keyFor = (table: string) => `columns:${table}`;

function read(table: string): string {
  try {
    return window.localStorage.getItem(keyFor(table)) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Hidden column ids for `table`, plus a toggle. Server render and first paint show all. */
export function useHiddenColumns(table: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(table),
    () => "",
  );
  const hidden = raw ? raw.split(",").filter(Boolean) : [];

  const toggle = useCallback(
    (id: string) => {
      const current = read(table).split(",").filter(Boolean);
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      try {
        window.localStorage.setItem(keyFor(table), next.join(","));
      } catch {
        // Not remembered; the change still applies until reload.
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [table],
  );
  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(keyFor(table));
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EVENT));
  }, [table]);

  return { hidden, toggle, reset };
}
