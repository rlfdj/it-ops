import { CheckIcon } from "lucide-react";
import { Aed, BaseCurrency } from "@/components/aed";
import { formatDate } from "@/lib/dates";
import {
  DOC_REQUIRED_FROM,
  docState,
  lineTotal,
  docList,
  missingToClose,
  nextManualStage,
  PO_STAGES,
  STAGE_LABEL,
  stageIndex,
  type PoTotal,
} from "@/lib/procurement";
import type { PoDetail } from "@/lib/queries/procurement";
import { AdvanceStage, EditPurchase } from "./controls";
import { DocSlot } from "./doc-slot";
import { InvoiceDateEdit } from "./invoice-date-dialog";
import { StageStatus } from "./stage-status";

const COLS = "minmax(0, 1fr) 40px 104px 112px";
const SLOT_ORDER = ["invoice", "delivery_note", "approval"] as const;

export function PoPanel({
  po,
  vendors,
  today,
}: {
  po: PoDetail;
  vendors: string[];
  today: string;
}) {
  const current = stageIndex(po.status);
  const next = nextManualStage(po.status);
  // Closing needs the approval, invoice and delivery note (the server enforces it too).
  const missingForClose = next === "closed" ? missingToClose(Object.keys(po.documents)) : [];

  return (
    <aside className="panel min-[1024px]:flex-[2_1_360px]" aria-label={`Purchase ${po.poNumber}`}>
      <div className="panel-head">
        <div className="row1">
          <span className="mono">{po.poNumber}</span>
          <StageStatus stage={po.status} />
          <div className="acts">
            <EditPurchase
              poNumber={po.poNumber}
              vendors={vendors}
              today={today}
              values={{
                id: po.id,
                vendorName: po.vendor,
                requestedOn: po.requestedOn,
                notes: po.notes,
                invoiceNumber: po.invoiceNumber,
                vatApplied: po.vatApplied,
                discountAed: po.discountAed,
                project: po.project,
                status: po.status,
                lines: po.lines,
              }}
            />
          </div>
        </div>
        <h2 className="h2 lg">{po.vendor}</h2>
        <div className="fig lg">
          <Aed value={po.totalAed} />
        </div>
      </div>

      <div className="stack">
        <ol className="stepper" aria-label="Stage">
          {PO_STAGES.map((s, i) => (
            <li
              key={s}
              aria-current={i === current ? "step" : undefined}
              className={i < current ? "step past" : "step"}
            >
              <span className="step-l">
                {i < current ? <CheckIcon size={12} strokeWidth={2} aria-hidden /> : null}
                {STAGE_LABEL[s]}
              </span>
            </li>
          ))}
        </ol>
        {po.status === "requested" ? (
          <p className="m-0 text-[12px] text-ink3">
            Attach the signed approval file below and this PO moves to Approved.
          </p>
        ) : next ? (
          <div className="row">
            <AdvanceStage
              poId={po.id}
              poNumber={po.poNumber}
              to={next}
              blockedReason={
                missingForClose.length
                  ? `Upload ${docList(missingForClose)} to close this purchase.`
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>

      <dl className="kv">
        <dt>Requested</dt>
        <dd>{formatDate(po.requestedOn)}</dd>
        {po.project ? (
          <>
            <dt>Project</dt>
            <dd>{po.project}</dd>
          </>
        ) : null}
        {po.invoiceNumber ? (
          <>
            <dt>Invoice number</dt>
            <dd className="mono">{po.invoiceNumber}</dd>
          </>
        ) : null}
        {po.invoiceDate || po.documents.invoice ? (
          <>
            <dt>Invoice date</dt>
            <dd className="flex items-center gap-2">
              {po.invoiceDate ? (
                formatDate(po.invoiceDate)
              ) : (
                <span className="text-ink3">Not set</span>
              )}
              <InvoiceDateEdit
                poId={po.id}
                poNumber={po.poNumber}
                invoiceDate={po.invoiceDate}
                today={today}
              />
            </dd>
          </>
        ) : null}
        {po.notes ? (
          <>
            <dt>Notes</dt>
            <dd className="whitespace-pre-line">{po.notes}</dd>
          </>
        ) : null}
      </dl>

      <section className="panel-section">
        <div className="ps-head">
          <span className="eyebrow">Line items</span>
        </div>
        <div role="table" aria-label="Line items">
          <div className="tr th" role="row" style={{ "--cols": COLS } as React.CSSProperties}>
            <span role="columnheader">Item</span>
            <span role="columnheader" className="r">
              Qty
            </span>
            <span role="columnheader" className="r">
              Unit <BaseCurrency />
            </span>
            <span role="columnheader" className="r">
              Total <BaseCurrency />
            </span>
          </div>
          {po.lines.map((l) => (
            <div
              key={l.id}
              className="tr"
              role="row"
              style={{ "--cols": COLS } as React.CSSProperties}
            >
              <span role="cell" className="whitespace-normal!">
                {l.description}
              </span>
              <span role="cell" className="r">
                {l.qty}
              </span>
              <span role="cell" className="r">
                <Aed value={l.unitPriceAed} />
              </span>
              <span role="cell" className="r fw-500">
                <Aed value={lineTotal(l)} />
              </span>
            </div>
          ))}
          <PoMoneyRows money={po.money} vat={po.vatApplied} />
        </div>
      </section>

      <section className="panel-section">
        <div className="ps-head">
          <span className="eyebrow">Documents</span>
        </div>
        {SLOT_ORDER.map((kind) => {
          const doc = po.documents[kind];
          return (
            <DocSlot
              key={kind}
              poId={po.id}
              poNumber={po.poNumber}
              invoiceDate={po.invoiceDate}
              today={today}
              kind={kind}
              state={docState(po.status, kind, Boolean(doc))}
              doc={doc}
              notNeededUntil={STAGE_LABEL[DOC_REQUIRED_FROM[kind]].toLowerCase()}
            />
          );
        })}
      </section>
    </aside>
  );
}

/** Subtotal / Discount / VAT 5% / Total under the lines (Discount and VAT only when used). */
function PoMoneyRows({ money, vat }: { money: PoTotal; vat: boolean }) {
  const rows: { label: string; value: number; negative?: boolean; strong?: boolean }[] = [
    { label: "Subtotal", value: money.subtotal },
    ...(money.discount > 0 ? [{ label: "Discount", value: money.discount, negative: true }] : []),
    ...(vat ? [{ label: "VAT 5%", value: money.vat }] : []),
    { label: "Total", value: money.total, strong: true },
  ];
  return (
    <>
      {rows.map((r) => (
        <div
          key={r.label}
          className="tr"
          role="row"
          style={{ "--cols": COLS } as React.CSSProperties}
        >
          <span
            role="cell"
            className={`r${r.strong ? " fw-500" : ""}`}
            style={{ gridColumn: "1 / 4" }}
          >
            {r.label}
          </span>
          <span role="cell" className={`r${r.strong ? " fw-500" : ""}`}>
            {r.negative ? "−" : ""}
            <Aed value={r.value} />
          </span>
        </div>
      ))}
    </>
  );
}

/** Empty panel when nothing is selected or the PO doesn't exist. */
export function PoPanelEmpty({ message }: { message: string }) {
  return (
    <aside className="panel min-[1024px]:flex-[2_1_360px]" aria-label="Purchase detail">
      <div className="empty">
        <b>No purchase selected</b>
        <span>{message}</span>
      </div>
    </aside>
  );
}
