"use client";

import { useEffect } from "react";

/**
 * Row/panel shortcuts broadcast by the global keyboard handler (see components/shell/shortcuts.tsx).
 * "next" is the row below (the K key) and "prev" the row above (J).
 */
export type ShortcutCommand = "next" | "prev" | "open" | "edit" | "close";

export const SHORTCUT_EVENT = "app:shortcut";

export function dispatchShortcut(command: ShortcutCommand) {
  window.dispatchEvent(new CustomEvent<ShortcutCommand>(SHORTCUT_EVENT, { detail: command }));
}

/** Subscribe a table or panel to K / J / Enter / E / Esc. */
export function useShortcut(handler: (command: ShortcutCommand) => void) {
  useEffect(() => {
    const listener = (event: Event) => handler((event as CustomEvent<ShortcutCommand>).detail);
    window.addEventListener(SHORTCUT_EVENT, listener);
    return () => window.removeEventListener(SHORTCUT_EVENT, listener);
  }, [handler]);
}

/** True when keystrokes should go to a field rather than trigger shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      type,
    );
  }
  return Boolean(target.closest("[role='combobox'], [cmdk-input]"));
}
