"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShell } from "./shell-context";
import { moduleForPath, NAV, newHrefFor } from "@/lib/nav";
import { requestNew } from "./new-request";
import { dispatchShortcut, isTypingTarget } from "@/hooks/use-shortcut";

const G_TIMEOUT_MS = 1200;

/**
 * Global keyboard shortcuts:
 *   ⌘K / Ctrl+K  search      N  new record     /  focus the filter
 *   K / J        move down / up a row   Enter  open row   E  edit   Esc  close panel
 *   [            hide or show the sidebar
 *   G then D/P/A/T/S/O/B/L    go to a module
 * Nothing fires while focus is in a field (except ⌘K).
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const { paletteOpen, setPaletteOpen, setNewMenuOpen, toggleSidebar } = useShell();
  const gPressedAt = useRef(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (paletteOpen || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Leave keys alone while a dialog or menu has focus.
      if (target?.closest("[role='dialog'], [role='menu']")) return;

      const key = event.key.toLowerCase();

      if (Date.now() - gPressedAt.current < G_TIMEOUT_MS) {
        gPressedAt.current = 0;
        const destination = NAV.find((n) => n.goKey === key);
        if (destination) {
          event.preventDefault();
          router.push(destination.href);
        }
        return;
      }

      switch (key) {
        case "g":
          gPressedAt.current = Date.now();
          return;
        case "n": {
          event.preventDefault();
          const href = newHrefFor(moduleForPath(pathname));
          if (href) requestNew(href, router.push);
          else setNewMenuOpen(true);
          return;
        }
        case "/": {
          const filter = document.querySelector<HTMLElement>("[data-filter]");
          if (filter) {
            event.preventDefault();
            filter.focus();
          }
          return;
        }
        case "j":
          dispatchShortcut("prev"); // J moves up
          return;
        case "k":
          dispatchShortcut("next"); // K moves down
          return;
        case "[":
          event.preventDefault();
          toggleSidebar();
          return;
        case "enter":
          if (target?.closest("a, button")) return;
          dispatchShortcut("open");
          return;
        case "e":
          dispatchShortcut("edit");
          return;
        case "escape":
          dispatchShortcut("close");
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, pathname, paletteOpen, setPaletteOpen, setNewMenuOpen, toggleSidebar]);

  return null;
}
