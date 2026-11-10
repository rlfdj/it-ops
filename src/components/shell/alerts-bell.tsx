"use client";

import { useCallback, useEffect, useState } from "react";
import { Popover } from "radix-ui";
import { BellIcon, XIcon } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import type { AlertWithState } from "@/lib/alerts";
import { readAllAlerts, updateAlert } from "@/app/(app)/alerts-actions";

/**
 * The notifications bell: renewals closing in, recently overdue tasks and purchases still
 * missing documents. The alerts are derived from live data each time; only "read" and
 * "dismissed" are remembered.
 */
export function AlertsBell() {
  const [alerts, setAlerts] = useState<AlertWithState[] | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/alerts", { cache: "no-store" });
      if (response.ok) setAlerts((await response.json()) as AlertWithState[]);
    } catch {
      // Keep what is shown; the next refresh retries.
    }
  }, []);

  // Load on mount and each time the panel opens (not on every navigation: each load costs
  // several queries, and pages share a small connection pool).
  useEffect(() => {
    const controller = new AbortController();
    fetch("/alerts", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((next: AlertWithState[] | null) => next && setAlerts(next))
      .catch(() => {
        // Keep what is shown; the next refresh retries.
      });
    return () => controller.abort();
  }, [open]);

  const unread = alerts?.filter((a) => !a.read).length ?? 0;

  const change = async (key: string, state: "read" | "dismissed") => {
    setAlerts(
      (all) =>
        all
          ?.filter((a) => !(state === "dismissed" && a.key === key))
          .map((a) => (a.key === key ? { ...a, read: true } : a)) ?? null,
    );
    if (!(await updateAlert(key, state))) void refresh();
  };

  const markAll = async () => {
    const keys = alerts?.filter((a) => !a.read).map((a) => a.key) ?? [];
    setAlerts((all) => all?.map((a) => ({ ...a, read: true })) ?? null);
    if (!(await readAllAlerts(keys))) void refresh();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative max-[760px]:w-7!"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          title="Notifications"
        >
          <BellIcon size={16} strokeWidth={1.75} aria-hidden />
          {unread ? (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--red-press)] px-1 text-[10px] leading-none font-semibold text-white"
              data-testid="alerts-count"
              aria-hidden
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          aria-label="Notifications"
          className="z-50 w-[380px] max-w-[calc(var(--vw100)-16px)] rounded-lg border border-line2 bg-surface-2 text-ink shadow-1"
        >
          <div className="flex items-center justify-between border-b border-line2 px-3 py-2">
            <b className="text-[13px] font-semibold">Notifications</b>
            {unread ? (
              <button type="button" className="link text-[12px]" onClick={markAll}>
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="m-0 max-h-[min(420px,calc(var(--vh100)-120px))] list-none overflow-y-auto p-0">
            {alerts === null ? (
              <li className="cap px-3 py-6 text-center">Loading…</li>
            ) : alerts.length === 0 ? (
              <li className="cap px-3 py-6 text-center">You’re all caught up.</li>
            ) : (
              alerts.map((a) => (
                <li
                  key={a.key}
                  className="flex items-start gap-1 border-b border-line2 last:border-b-0"
                  data-testid="alert-row"
                >
                  <Link
                    href={a.href}
                    className={`flex min-w-0 flex-1 gap-2 px-3 py-2.5 hover:bg-sunk hover:no-underline ${a.read ? "opacity-70" : ""}`}
                    onClick={() => {
                      setOpen(false);
                      if (!a.read) void change(a.key, "read");
                    }}
                  >
                    <span
                      className={`mt-1.5 size-2 flex-none rounded-full ${a.tone === "red" ? "bg-[var(--red)]" : "bg-[var(--amber)]"}`}
                      aria-hidden
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={`text-[13px] ${a.read ? "" : "font-semibold"}`}>
                        {a.title}
                      </span>
                      <span className="cap">{a.detail}</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="mt-2 mr-2 flex size-6 flex-none items-center justify-center rounded text-ink3 hover:bg-sunk hover:text-ink"
                    aria-label={`Dismiss: ${a.title}`}
                    onClick={() => change(a.key, "dismissed")}
                  >
                    <XIcon size={13} aria-hidden />
                  </button>
                </li>
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
