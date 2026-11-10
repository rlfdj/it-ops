import Link from "@/components/link";

export type ViewTab = {
  key: string;
  label: string;
  href: string;
  /** Rows in this view; omit for a view with no meaningful count. */
  count?: number | string;
  current: boolean;
};

/**
 * The one view switcher for every list (B-26): underlined tabs with a count each. Links, so
 * the view lives in the URL and Back works.
 */
export function ViewTabs({ label, tabs }: { label: string; tabs: ViewTab[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.current ? "page" : undefined}
          scroll={false}
        >
          {t.label}
          {t.count !== undefined ? <span className="c">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
