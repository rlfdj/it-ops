"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ShellState = {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** The create menu behind "New" on screens with no create flow of their own (B-31). */
  newMenuOpen: boolean;
  setNewMenuOpen: (open: boolean) => void;
  sidebarHidden: boolean;
  toggleSidebar: () => void;
};

const ShellContext = createContext<ShellState | null>(null);

const YEAR = 60 * 60 * 24 * 365;

export function ShellProvider({
  children,
  initialSidebarHidden = false,
}: {
  children: ReactNode;
  /** Read from the cookie on the server, so the first paint already has the right layout. */
  initialSidebarHidden?: boolean;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(initialSidebarHidden);

  const toggleSidebar = useCallback(() => {
    const next = !sidebarHidden;
    setSidebarHidden(next);
    document.cookie = `sidebar=${next ? "hidden" : "shown"}; path=/; max-age=${YEAR}; samesite=lax`;
  }, [sidebarHidden]);

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      newMenuOpen,
      setNewMenuOpen,
      sidebarHidden,
      toggleSidebar,
    }),
    [paletteOpen, newMenuOpen, sidebarHidden, toggleSidebar],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}
