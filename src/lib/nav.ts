export type ModuleKey =
  | "dashboard"
  | "activity"
  | "procurement"
  | "stock"
  | "tasks"
  | "subscriptions"
  | "onboarding"
  | "board";

export type NavItem = {
  key: ModuleKey;
  href: `/${string}`;
  label: string;
  /** Key pressed after G to jump here. */
  goKey: string;
  group: "Overview" | "Operate";
  /** Label on the top-bar New button while in this module. */
  newLabel?: string;
  /** What the sidebar count next to the label counts (read out and shown as a tooltip). */
  countLabel?: string;
};

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/", label: "Dashboard", goKey: "d", group: "Overview" },
  { key: "activity", href: "/activity", label: "Activity log", goKey: "l", group: "Overview" },
  {
    key: "procurement",
    href: "/procurement",
    label: "Procurement",
    goKey: "p",
    group: "Operate",
    newLabel: "New purchase",
    countLabel: "open purchase orders",
  },
  {
    key: "stock",
    href: "/stock",
    label: "Stock",
    goKey: "a",
    group: "Operate",
    newLabel: "Add stock",
    countLabel: "items in stock",
  },
  {
    key: "tasks",
    href: "/tasks",
    label: "Tasks",
    goKey: "t",
    group: "Operate",
    newLabel: "New task",
    countLabel: "pending tasks",
  },
  {
    key: "subscriptions",
    href: "/subscriptions",
    label: "Subscriptions",
    goKey: "s",
    group: "Operate",
    newLabel: "New subscription",
    countLabel: "active subscriptions",
  },
  {
    key: "onboarding",
    href: "/onboarding",
    label: "On / Offboarding",
    goKey: "o",
    group: "Operate",
    newLabel: "New checklist",
    countLabel: "open checklists",
  },
  {
    key: "board",
    href: "/board",
    label: "Board",
    goKey: "b",
    group: "Operate",
    newLabel: "New note",
  },
];

/** The module a path belongs to; undefined for pages that are not a module (Settings). */
export function findModuleForPath(pathname: string): NavItem | undefined {
  if (pathname === "/") return NAV[0];
  return NAV.filter((n) => n.href !== "/").find(
    (n) => pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
}

/**
 * The module a path belongs to, for the top bar (New button, breadcrumb); pages that are
 * not a module fall back to the Dashboard. The sidebar uses `findModuleForPath` instead.
 */
export function moduleForPath(pathname: string): NavItem {
  return findModuleForPath(pathname) ?? NAV[0]!;
}

/** Where "New" goes from a module: the module's own create flow (opened via ?new=1). */
export function newHrefFor(item: NavItem): string | null {
  return item.newLabel ? `${item.href}?new=1` : null;
}

/** "5 open purchase orders", singular for 1 ("1 open purchase order"). */
export function countPhrase(item: NavItem, n: number): string {
  const label = item.countLabel ?? "";
  return `${n} ${n === 1 ? label.replace(/s$/, "").replace(/s /, " ") : label}`.trim();
}
