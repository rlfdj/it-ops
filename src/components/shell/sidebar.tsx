"use client";

import Link from "@/components/link";
import { usePathname } from "next/navigation";
import {
  CreditCardIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MenuIcon,
  PackageIcon,
  ShoppingCartIcon,
  StickyNoteIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useShell } from "./shell-context";
import { countPhrase, findModuleForPath, NAV, type ModuleKey } from "@/lib/nav";
import type { NavCounts } from "@/lib/queries/nav-counts";

const GROUPS = ["Overview", "Operate"] as const;

export const NAV_ICONS: Record<ModuleKey, LucideIcon> = {
  dashboard: LayoutDashboardIcon,
  activity: HistoryIcon,
  procurement: ShoppingCartIcon,
  stock: PackageIcon,
  tasks: ListChecksIcon,
  subscriptions: CreditCardIcon,
  onboarding: UsersIcon,
  board: StickyNoteIcon,
};

/**
 * The module links with their counts, shared by the sidebar and the phone drawer. Each
 * count says what it counts: as hidden text for screen readers and as a tooltip (B-32).
 * With `railTitles`, links also carry the module name as a tooltip (collapsed rail).
 */
export function NavLinks({
  counts,
  railTitles = false,
  onNavigate,
}: {
  counts: NavCounts;
  railTitles?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = findModuleForPath(pathname)?.key;
  return GROUPS.map((group) => (
    <div key={group} className="navgroup">
      <div className="navlabel">{group}</div>
      <nav className="nav" aria-label={group}>
        {NAV.filter((n) => n.group === group).map((item) => {
          const Icon = NAV_ICONS[item.key];
          const count = counts[item.key];
          const phrase = count === undefined ? null : countPhrase(item, count);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              title={phrase ? `${item.label} · ${phrase}` : railTitles ? item.label : undefined}
              onClick={onNavigate}
            >
              <Icon className="ni" size={18} strokeWidth={1.75} aria-hidden />
              <span className="nl">{item.label}</span>
              {count !== undefined ? (
                <span className="n">
                  {count}
                  <span className="sr-only"> {phrase!.replace(/^\d+ /, "")}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  ));
}

/**
 * The primary navigation. Expanded it shows icons, labels and counts; collapsed (menu
 * button or `[`) it slides down to an icon rail, with the label and count as a tooltip.
 * On phones it is hidden: the same links open in a drawer from the top bar (MobileNav).
 */
export function Sidebar({ counts }: { counts: NavCounts }) {
  const { sidebarHidden: collapsed, toggleSidebar } = useShell();

  return (
    <aside id="sidebar" className="side" aria-label="Primary">
      <div className="side-head">
        <button
          type="button"
          className="btn ghost icon side-menu"
          onClick={toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="sidebar"
          aria-keyshortcuts="["
          title={collapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
        >
          <MenuIcon size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <NavLinks counts={counts} railTitles={collapsed} />
    </aside>
  );
}
