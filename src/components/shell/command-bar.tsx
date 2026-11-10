"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useShell } from "./shell-context";
import { toggleTheme } from "./theme-toggle";
import { NAV, newHrefFor } from "@/lib/nav";
import { requestNew } from "./new-request";
import { searchRecords, type SearchResult } from "@/app/(app)/actions";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  po: "Purchase orders",
  stock: "In stock",
  subscription: "Subscriptions",
  seat: "Seats",
  person: "People",
  note: "Board notes",
};

export function CommandBar() {
  const router = useRouter();
  const { paletteOpen, setPaletteOpen, sidebarHidden, toggleSidebar } = useShell();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();

  // Debounced record search on the server.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => setResults(await searchRecords(q)));
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const close = () => {
    setPaletteOpen(false);
    setQuery("");
    setResults([]);
  };
  const go = (href: string) => {
    close();
    router.push(href);
  };

  type Action = {
    id: string;
    label: string;
    keywords: string;
    shortcut?: string;
    run: () => void;
  };
  const actions: Action[] = [
    ...NAV.filter((n) => n.newLabel).map((n) => ({
      id: `new-${n.key}`,
      label: n.newLabel!,
      keywords: `new create add ${n.label}`,
      run: () => {
        close();
        requestNew(newHrefFor(n)!, router.push);
      },
    })),
    {
      id: "sidebar",
      label: sidebarHidden ? "Expand sidebar" : "Collapse sidebar",
      keywords: "sidebar navigation collapse expand menu",
      shortcut: "[",
      run: () => {
        toggleSidebar();
        close();
      },
    },
    {
      id: "theme",
      label: "Toggle light / dark mode",
      keywords: "theme dark light",
      run: () => {
        toggleTheme();
        close();
      },
    },
  ];

  const q = query.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const pages = NAV.filter((n) => matches(`${n.label} go ${n.key}`));
  const visibleActions = actions.filter((a) => matches(`${a.label} ${a.keywords}`));
  const shownResults = q.length < 2 ? [] : results;
  const grouped = Object.entries(
    shownResults.reduce<Partial<Record<SearchResult["kind"], SearchResult[]>>>((acc, r) => {
      (acc[r.kind] ??= []).push(r);
      return acc;
    }, {}),
  ) as [SearchResult["kind"], SearchResult[]][];

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={(open) => (open ? setPaletteOpen(true) : close())}
      title="Search"
      description="Search records, jump to a module or run an action"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          placeholder="Search POs, stock, subscriptions, people, notes…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {searching ? "Searching…" : `Nothing matches “${query.trim()}”.`}
          </CommandEmpty>

          {grouped.map(([kind, rows]) => (
            <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
              {rows.map((r) => (
                <CommandItem
                  key={`${r.kind}-${r.id}`}
                  value={`${r.kind}-${r.id}`}
                  onSelect={() => go(r.href)}
                >
                  <span className={r.mono ? "id" : "font-medium"}>{r.title}</span>
                  <span className="min-w-0 truncate text-ink3">{r.detail}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {pages.length ? (
            <CommandGroup heading="Go to">
              {pages.map((n) => (
                <CommandItem key={n.key} value={`go-${n.key}`} onSelect={() => go(n.href)}>
                  {n.label}
                  <CommandShortcut className="flex gap-1 tracking-normal">
                    <span className="kbd">G</span>
                    <span className="kbd">{n.goKey.toUpperCase()}</span>
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {visibleActions.length ? (
            <CommandGroup heading="Actions">
              {visibleActions.map((a) => (
                <CommandItem key={a.id} value={a.id} onSelect={a.run}>
                  {a.label}
                  {a.shortcut ? (
                    <CommandShortcut className="flex gap-1 tracking-normal">
                      <span className="kbd">{a.shortcut}</span>
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
