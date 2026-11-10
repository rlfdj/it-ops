import type { ReactNode } from "react";
import Link from "@/components/link";

export type EmptyAction = { label: string; href: string; primary?: boolean };

/**
 * An empty list or panel: what is missing, why, and real buttons for the next step
 * (never "press a key"). Actions are links, so they work in server components.
 */
export function EmptyState({
  title,
  children,
  actions = [],
}: {
  title: string;
  children?: ReactNode;
  actions?: EmptyAction[];
}) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children ? <span>{children}</span> : null}
      {actions.length ? (
        <div className="actions">
          {actions.map((a) => (
            <Link key={a.label} href={a.href} className={a.primary ? "btn pri" : "btn"}>
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
