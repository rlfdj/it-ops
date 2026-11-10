"use client";

import type { ReactNode } from "react";
import { useShell } from "./shell-context";

/** The app's flex row. `data-sidebar="hidden"` collapses the sidebar (not on phones). */
export function AppFrame({ children }: { children: ReactNode }) {
  const { sidebarHidden } = useShell();
  return (
    <div className="app" data-sidebar={sidebarHidden ? "hidden" : "shown"}>
      {children}
    </div>
  );
}
