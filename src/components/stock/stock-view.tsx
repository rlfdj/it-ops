import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import {
  listPeopleNames,
  listStock,
  parseStockView,
  type StockView as View,
} from "@/lib/queries/stock";
import { StockTable } from "./stock-table";
import { AddStock } from "./add-stock-dialog";
import { ImportStock } from "./import-stock-dialog";
import { ExportButton } from "@/components/export-button";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const VIEWS: { value: View; label: string }[] = [
  { value: "in_stock", label: "In stock" },
  { value: "deployed", label: "Deployed" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
];

export async function StockView({ params }: { params: Params }) {
  const [all, peopleNames] = await Promise.all([listStock(), listPeopleNames()]);
  const today = todayIn((await getWorkspaceSettings()).timeZone);
  const q = one(params.q) ?? "";
  const view = parseStockView(one(params.view));
  const count = (s: View) => (s === "all" ? all.length : all.filter((r) => r.status === s).length);
  const rows = view === "all" ? all : all.filter((r) => r.status === view);
  const hrefFor = (v: View) => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (v !== "in_stock") next.set("view", v);
    return next.size ? `/stock?${next}` : "/stock";
  };

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">
            IT store · {count("in_stock")} in stock · {count("deployed")} deployed
          </span>
          <h1 className="h1">Stock</h1>
        </div>
        <div className="right">
          <div className="seg" role="group" aria-label="Show">
            {VIEWS.map((v) => (
              <Link
                key={v.value}
                href={hrefFor(v.value)}
                aria-current={view === v.value ? "page" : undefined}
                scroll={false}
              >
                {v.label} {count(v.value)}
              </Link>
            ))}
          </div>
          <ImportStock />
          <ExportButton
            href={view === "in_stock" ? "/stock/export" : `/stock/export?view=${view}`}
            empty={all.length === 0}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={
            view === "in_stock"
              ? "Nothing in stock"
              : view === "deployed"
                ? "Nothing deployed"
                : view === "retired"
                  ? "Nothing retired"
                  : "No stock yet"
          }
          actions={
            view === "in_stock" || view === "all"
              ? [{ label: "Add stock", href: "/stock?new=1", primary: true }]
              : [{ label: "Show in stock", href: "/stock" }]
          }
        >
          {view === "in_stock" || view === "all"
            ? "Add items as they come in, or use Import CSV above."
            : "Check items out from the In stock list to see them here."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <StockTable
            key={`${q}|${view}`}
            rows={rows}
            today={today}
            view={view}
            people={peopleNames}
            initialFilter={q}
          />
        </div>
      )}

      <AddStock open={one(params.new) === "1"} />
    </main>
  );
}
