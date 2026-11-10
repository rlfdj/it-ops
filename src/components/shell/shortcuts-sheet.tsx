"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { isTypingTarget } from "@/hooks/use-shortcut";
import { ShortcutsList } from "./shortcuts-list";

/** Event the account menu dispatches to open the sheet. */
export const OPEN_SHORTCUTS_EVENT = "itops:open-shortcuts";

/** The "?" sheet listing every keyboard binding. Mounted once in the app layout. */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[role='dialog'], [role='menu']")) return;
      event.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, onOpen);
    };
  }, []);

  return (
    <FormDialog
      open={open}
      onOpenChange={setOpen}
      wide
      title="Keyboard shortcuts"
      description="Shortcuts pause while you type in a field."
      footer={<Button onClick={() => setOpen(false)}>Close</Button>}
    >
      <ShortcutsList />
    </FormDialog>
  );
}
