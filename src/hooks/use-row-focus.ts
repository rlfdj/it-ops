"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

/** Attribute that marks a table row so focus can be moved to it by id. */
export const ROW_ID_ATTR = "data-row-id";

/** Moves DOM focus to a row (and scrolls it into view). Returns false if it isn't rendered. */
export function focusRow(container: HTMLElement | null, id: string): boolean {
  const row = container?.querySelector<HTMLElement>(`[${ROW_ID_ATTR}="${CSS.escape(id)}"]`);
  if (!row) return false;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
  return true;
}

/**
 * Arrow / Home / End on a focused row move to another row (B-18). `move` receives the
 * step: -1 / 1, or "first" / "last". Keys pressed inside a row's own controls are ignored.
 */
export function rowArrowKeys(
  event: KeyboardEvent<HTMLElement>,
  move: (step: -1 | 1 | "first" | "last") => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const step =
    event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : event.key === "Home"
          ? "first"
          : event.key === "End"
            ? "last"
            : null;
  if (step === null) return;
  event.preventDefault();
  move(step);
}

/** Index reached from `index` after `step`, clamped to the list (-1 means "no row yet"). */
export function stepIndex(index: number, length: number, step: -1 | 1 | "first" | "last") {
  if (step === "first") return 0;
  if (step === "last") return length - 1;
  if (index === -1) return 0;
  return Math.min(length - 1, Math.max(0, index + step));
}

const RESTORE_WINDOW_MS = 4000;

/**
 * After a write the list refreshes and the focused row can disappear (a ticked task leaves
 * the Open view, a checked-out unit leaves Stock), which drops focus to <body>. This puts
 * focus back on the row now sitting where the old one was (WCAG 2.4.3). Only acts when the
 * focus was in the table moments ago and is now lost, so it never steals focus.
 */
export function useFocusRestore(container: React.RefObject<HTMLElement | null>, rowIds: string[]) {
  const last = useRef<{ index: number; at: number } | null>(null);

  const remember = useCallback(
    (id: string) => {
      const index = rowIds.indexOf(id);
      if (index !== -1) last.current = { index, at: Date.now() };
    },
    [rowIds],
  );

  useEffect(() => {
    const seen = last.current;
    if (!seen || Date.now() - seen.at > RESTORE_WINDOW_MS) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const id = rowIds[Math.min(seen.index, rowIds.length - 1)];
    if (id) focusRow(container.current, id);
    last.current = null;
    // Runs when the rows change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds.join("|")]);

  return remember;
}
