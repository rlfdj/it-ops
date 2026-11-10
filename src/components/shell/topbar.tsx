"use client";

import { useRef, useSyncExternalStore } from "react";
import Link from "@/components/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDownIcon,
  KeyboardIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkspaceMark } from "./logo";
import { useWorkspace } from "@/components/workspace-context";
import { AlertsBell } from "./alerts-bell";
import { OPEN_SHORTCUTS_EVENT } from "./shortcuts-sheet";
import { ThemeToggle } from "./theme-toggle";
import { useShell } from "./shell-context";
import { requestNew } from "./new-request";
import { MobileNav } from "./mobile-nav";
import { moduleForPath, NAV, newHrefFor } from "@/lib/nav";
import type { NavCounts } from "@/lib/queries/nav-counts";

const noop = () => () => {};
/** "⌘K" on Apple platforms, "Ctrl K" elsewhere (F115). The server renders "Ctrl K". */
function useSearchShortcut() {
  return useSyncExternalStore(
    noop,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

/**
 * Breadcrumb for a selected record (module, then the record segment). Module pages show
 * nothing: the page heading already names the module.
 */
function Breadcrumb({ pathname }: { pathname: string }) {
  if (pathname === "/settings") return null; // the page heading names it
  const item = moduleForPath(pathname);
  const rest = pathname
    .slice(item.href === "/" ? 1 : item.href.length + 1)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (rest.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="crumb">
      <Link href={item.href}>{item.label}</Link>
      {rest.map((segment, i) => (
        <span key={segment}>
          {" / "}
          {i === rest.length - 1 ? <span className="id">{segment}</span> : segment}
        </span>
      ))}
    </nav>
  );
}

/** Initials in a circle; opens the account menu (who is signed in, Sign out). */
function AccountMenu() {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  return (
    <>
      <form ref={form} action="/auth/signout" method="post" hidden />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="top-avatar" aria-label="Account" title="Account">
            IT
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel>
            <span className="block">Signed in</span>
            <span className="cap block font-normal">IT Ops</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/settings")}>
            <SettingsIcon size={14} strokeWidth={1.75} aria-hidden /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT))}>
            <KeyboardIcon size={14} strokeWidth={1.75} aria-hidden /> Keyboard shortcuts
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => form.current?.requestSubmit()}>
            <LogOutIcon size={14} strokeWidth={1.75} aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * The full-width app bar (owner's reference: Microsoft 365 admin center): product name on
 * the left, search in the middle, New, theme and account on the right.
 */
export function Topbar({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setPaletteOpen, newMenuOpen, setNewMenuOpen } = useShell();
  const item = moduleForPath(pathname);
  const newHref = newHrefFor(item);
  const shortcut = useSearchShortcut();
  const { workspaceName } = useWorkspace();

  return (
    <header className="top">
      <div className="top-start">
        <MobileNav counts={counts} />
        <Link
          href="/"
          aria-label={`${workspaceName} — Dashboard`}
          className="wordmark hover:no-underline"
        >
          <WorkspaceMark />
        </Link>
        <Breadcrumb pathname={pathname} />
      </div>
      <button
        type="button"
        className="search"
        onClick={() => setPaletteOpen(true)}
        aria-label="Search records and actions"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <SearchIcon size={14} strokeWidth={2} aria-hidden />
        <span>Search POs, stock, people…</span>
        <span className="kbd">{shortcut}</span>
      </button>
      <div className="actions">
        {newHref ? (
          <Button
            variant="primary"
            aria-keyshortcuts="N"
            aria-label={item.newLabel}
            onClick={() => requestNew(newHref, router.push)}
          >
            <PlusIcon size={14} strokeWidth={2} aria-hidden />
            <span className="t">{item.newLabel}</span>
            <span className="kbd">N</span>
          </Button>
        ) : (
          // Dashboard and Activity have nothing of their own to create: New lists every
          // create action instead of opening the search palette (B-31).
          <DropdownMenu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" aria-keyshortcuts="N" aria-label="New">
                <PlusIcon size={14} strokeWidth={2} aria-hidden />
                <span className="t">New</span>
                <ChevronDownIcon size={12} strokeWidth={2} aria-hidden className="chev" />
                <span className="kbd">N</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel>Create</DropdownMenuLabel>
              {NAV.filter((n) => n.newLabel).map((n) => (
                <DropdownMenuItem
                  key={n.key}
                  onSelect={() => requestNew(newHrefFor(n)!, router.push)}
                >
                  {n.newLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <AlertsBell />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}
