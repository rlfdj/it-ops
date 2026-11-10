"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { MenuIcon, XIcon } from "lucide-react";
import { WorkspaceMark } from "./logo";
import { NavLinks } from "./sidebar";
import type { NavCounts } from "@/lib/queries/nav-counts";

/**
 * Phones only (CSS hides it above 760px): a menu button in the top bar that opens the
 * module links in a left drawer. A Radix Dialog gives the focus trap, Esc and a labelled
 * dialog; the drawer closes on every route change and when the window grows past a phone.
 */
export function MobileNav({ counts }: { counts: NavCounts }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close when the route changes (a link was followed).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const query = window.matchMedia("(min-width: 761px)");
    const onChange = () => query.matches && setOpen(false);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className="btn ghost icon top-menu"
          aria-label="Open navigation"
          title="Open navigation"
        >
          <MenuIcon size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay" />
        <DialogPrimitive.Content className="drawer">
          <div className="drawer-head">
            <DialogPrimitive.Title className="wordmark">
              <WorkspaceMark />
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button type="button" className="btn ghost icon" aria-label="Close navigation">
                <XIcon size={18} strokeWidth={1.75} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            Go to a module
          </DialogPrimitive.Description>
          <NavLinks counts={counts} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
