import "server-only";
import { cookies } from "next/headers";

export const THEME_COOKIE = "theme";

export type Theme = "light" | "dark";

/** Explicit theme from the cookie, or null to follow the system preference. */
export async function getTheme(): Promise<Theme | null> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === "light" || value === "dark" ? value : null;
}

export const SIDEBAR_COOKIE = "sidebar";

/** True when the owner collapsed the sidebar (remembered in a cookie, read here so there's no flash). */
export async function getSidebarHidden(): Promise<boolean> {
  return (await cookies()).get(SIDEBAR_COOKIE)?.value === "hidden";
}
