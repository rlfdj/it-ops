import { ViewTabs } from "@/components/view-tabs";
import { ExportButton } from "@/components/export-button";
import { ListFilter } from "@/components/list-controls";
import { todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { formatShortDate, quarterOf } from "@/lib/format";
import { PO_STAGES, STAGE_LABEL, type PoStage } from "@/lib/procurement";
import {
  getProcurementTotals,
  getPurchaseOrder,
  listPurchaseOrders,
  listVendors,
} from "@/lib/queries/procurement";
import { filterRows, parseSort, sortParam, sortRows, textParam } from "@/lib/list-view";
import { keysOf, PO_SORT_COLUMNS, PO_SORTS, poSearchFields } from "@/lib/list-sorts";
import { Aed } from "@/components/aed";
import { DetailSheet } from "@/components/detail-sheet";
import { PoTable } from "./po-table";
import { PoPanel, PoPanelEmpty } from "./po-panel";
import { MissingToggle, NewPurchase } from "./controls";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Params = Record<string, string | string[] | undefined>;

export async function ProcurementView({ params }: { params: Params }) {
  const stageParam = one(params.stage);
  const stage = PO_STAGES.includes(stageParam as PoStage) ? (stageParam as PoStage) : null;
  const onlyMissing = one(params.missing) === "1";
  const q = textParam(params.q);
  const sort = parseSort(one(params.sort), keysOf(PO_SORT_COLUMNS));
  const today = todayIn((await getWorkspaceSettings()).timeZone);
  const quarter = quarterOf(today);

  const [all, totals, vendorRows] = await Promise.all([
    listPurchaseOrders(),
    getProcurementTotals(quarter),
    listVendors(),
  ]);
  const vendors = vendorRows.map((v) => v.name);

  // Tab counts follow the text and "missing" filters, so the numbers agree with the list (B-25).
  const matched = filterRows(all, q, poSearchFields).filter(
    (p) => !onlyMissing || p.missing.length > 0,
  );
  const filtered = Boolean(q) || onlyMissing;
  const rows = sortRows(
    matched.filter((p) => !stage || p.status === stage),
    sort,
    PO_SORTS,
  );
  const selectedNumber = one(params.po) ?? rows[0]?.poNumber ?? null;
  const selected = selectedNumber ? await getPurchaseOrder(selectedNumber) : null;
  const missingCount = all.reduce((n, p) => n + p.missing.length, 0);
  const missingPos = all.filter((p) => p.missing.length > 0).length;

  // Query string for links, without the selected PO.
  const query = new URLSearchParams();
  if (stage) query.set("stage", stage);
  if (onlyMissing) query.set("missing", "1");
  if (q) query.set("q", q);
  if (sort) query.set("sort", sortParam(sort)!);
  const tabHref = (s: PoStage | null) => {
    const q = new URLSearchParams(query);
    if (s) q.set("stage", s);
    else q.delete("stage");
    return q.size ? `/procurement?${q}` : "/procurement";
  };

  const dates = Object.fromEntries(
    rows.map((r) => [r.poNumber, formatShortDate(r.requestedOn, today)]),
  );

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">Purchases · {quarter.year}</span>
          <h1 className="h1">Procurement</h1>
        </div>
        <div className="right">
          <div className="stat-band auto" aria-label="Key figures">
            <div className="stat">
              <span className="l">Open value</span>
              <span className="v">
                <Aed value={totals.openValue} />
              </span>
            </div>
            <div className="stat">
              <span className="l">{`Spent Q${quarter.quarter}`}</span>
              <span className="v">
                <Aed value={totals.spentQuarter} />
              </span>
            </div>
            <div className={missingCount ? "stat red" : "stat"}>
              <span className="l">Missing docs</span>
              <span className="v">{missingCount}</span>
              <span className="s">
                {missingPos} {missingPos === 1 ? "PO" : "POs"}
              </span>
            </div>
          </div>
          <ExportButton
            href={q ? `/procurement/export?q=${encodeURIComponent(q)}` : "/procurement/export"}
            empty={all.length === 0}
            title={q ? "Exports the purchases matching the filter text" : undefined}
          />
        </div>
      </div>

      <div className="toolbar">
        <ViewTabs
          label="Stage"
          tabs={[
            {
              key: "all",
              label: "All",
              count: filtered ? `${matched.length} of ${all.length}` : all.length,
              href: tabHref(null),
              current: stage === null,
            },
            ...PO_STAGES.map((s) => ({
              key: s,
              label: STAGE_LABEL[s],
              count: matched.filter((p) => p.status === s).length,
              href: tabHref(s),
              current: stage === s,
            })),
          ]}
        />
        <span className="toolbar-tools">
          <ListFilter
            key={q}
            label="Filter purchases"
            placeholder="PO, vendor or item"
            initial={q}
            resetParams={["po"]}
          />
          <MissingToggle checked={onlyMissing} />
        </span>
      </div>

      <div className="split">
        <div className="list min-[1024px]:flex-[3_1_580px]">
          <PoTable
            rows={rows}
            selected={selected?.poNumber ?? null}
            query={query.toString()}
            dates={dates}
            sort={sort}
            filtered={filtered}
            hasAny={all.length > 0}
          />
          {rows.length ? (
            <div className="legend" aria-label="Document legend">
              <span>
                <b>INV</b> Invoice
              </span>
              <span className="sep">·</span>
              <span>
                <b>DN</b> Delivery note
              </span>
              <span className="sep">·</span>
              <span>
                <b>APR</b> Approval
              </span>
              <span className="mark ok">Attached</span>
              <span className="mark miss">Missing</span>
              <span className="mark na">Not needed yet</span>
            </div>
          ) : null}
        </div>
        <DetailSheet
          param="po"
          label={selected ? `Purchase ${selected.poNumber}` : "Purchase detail"}
        >
          {selected ? (
            <PoPanel key={selected.id} po={selected} vendors={vendors} today={today} />
          ) : (
            <PoPanelEmpty
              message={
                selectedNumber
                  ? `${selectedNumber} doesn’t exist.`
                  : all.length
                    ? "Pick a stage with purchases, or clear the filter."
                    : "Create a purchase with New to get started."
              }
            />
          )}
        </DetailSheet>
      </div>

      <NewPurchase open={one(params.new) === "1"} vendors={vendors} today={today} />
    </main>
  );
}
