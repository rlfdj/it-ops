"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const YEAR = 60 * 60 * 24 * 365;

function subscribe(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDarkNow = () => document.documentElement.classList.contains("dark");

/** Switches to the opposite of the current theme and remembers it in a cookie. */
export function toggleTheme() {
  const next = isDarkNow() ? "light" : "dark";
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(next);
  document.cookie = `theme=${next}; path=/; max-age=${YEAR}; samesite=lax`;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDarkNow, () => false);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? (
        <SunIcon size={16} strokeWidth={1.75} aria-hidden />
      ) : (
        <MoonIcon size={16} strokeWidth={1.75} aria-hidden />
      )}
    </Button>
  );
}
