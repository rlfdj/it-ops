"use client";

import { useEffect, useSyncExternalStore, type KeyboardEvent, type ReactNode, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { dispatchShortcut, isTypingTarget } from "@/hooks/use-shortcut";
import { ROW_ID_ATTR } from "@/hooks/use-row-focus";

/**
 * Detail panels (`?po=`, `?sub=`) sit beside the list from 1024px. Below that they open as
 * a sheet: a right slide-over from 761px, a bottom sheet on phones (B-05). The URL param is
 * the one source of truth: the sheet is open while it is present, so Esc, the close button,
 * the backdrop and browser Back all just clear it.
 */
const NARROW = "(max-width: 1023px)";

const subscribe = (cb: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", cb);
  return () => query.removeEventListener("change", cb);
};

/** True below 1024px. The server and first client render say false (the side panel). */
export function useNarrow() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

/** Set when this page pushed the history entry that opened the sheet, so closing can pop it. */
let pushedByUs = false;

/**
 * Select a row. Below 1024px, opening the sheet pushes a history entry (so Back closes it);
 * moving between rows while it is open, and every selection at ≥1024px, replaces.
 */
export function openDetail(router: ReturnType<typeof useRouter>, param: string, href: string) {
  const narrow = window.matchMedia(NARROW).matches;
  const open = new URLSearchParams(window.location.search).has(param);
  if (narrow && !open) {
    pushedByUs = true;
    router.push(href, { scroll: false });
  } else {
    router.replace(href, { scroll: false });
  }
}

/** True while a detail sheet is open (the lists then leave DOM focus where it is). */
export const sheetIsOpen = () => Boolean(document.querySelector("[data-detail-sheet]"));

export function DetailSheet({
  param,
  label,
  children,
}: {
  /** The URL param that selects the record: "po" or "sub". */
  param: string;
  /** Accessible name of the sheet, e.g. "Purchase PO-2026-0007". */
  label: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const narrow = useNarrow();
  const open = narrow && search.has(param);
  const value = search.get(param);
  const rowId = useRef<string | null>(null);

  // Forget a stale push once the sheet is closed, or the page is left.
  useEffect(() => {
    if (!open) pushedByUs = false;
  }, [open]);
  useEffect(
    () => () => {
      pushedByUs = false;
    },
    [],
  );

  // Remember which row is selected, so focus can return to it on close.
  useEffect(() => {
    if (!open) return;
    const row = document.querySelector<HTMLElement>("[role='row'][aria-selected='true']");
    rowId.current = row?.getAttribute(ROW_ID_ATTR) ?? null;
  }, [open, value]);

  if (!narrow) return <>{children}</>;

  const close = () => {
    if (pushedByUs) {
      pushedByUs = false;
      router.back();
      return;
    }
    const params = new URLSearchParams(search.toString());
    params.delete(param);
    const s = params.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  // J / K are ignored by the global handler while a dialog has focus, so the sheet passes
  // them on to the list, which moves the selection (the sheet follows).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
    const key = event.key.toLowerCase();
    if (key !== "j" && key !== "k") return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target || isTypingTarget(target)) return;
    // Keys from a form dialog opened on top of the sheet are theirs.
    if (target.closest("[role='dialog'], [role='alertdialog']") !== event.currentTarget) return;
    if (target.closest("[role='menu'], [role='listbox']")) return;
    event.preventDefault();
    dispatchShortcut(key === "j" ? "prev" : "next");
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="sheet-overlay" />
        <DialogPrimitive.Content
          className="sheet"
          data-detail-sheet=""
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            // Back to the row that was open, not to wherever focus was when it opened.
            event.preventDefault();
            const id = rowId.current;
            const row = id
              ? document.querySelector<HTMLElement>(`[${ROW_ID_ATTR}="${CSS.escape(id)}"]`)
              : null;
            row?.focus({ preventScroll: true });
          }}
        >
          <div className="sheet-head">
            <DialogPrimitive.Title className="sheet-title">{label}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="btn ghost icon" aria-label="Close detail">
                <XIcon size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Details of the selected row. J and K move to the next or previous row.
          </DialogPrimitive.Description>
          <div className="sheet-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
