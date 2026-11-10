"use client";

import { DateField } from "@/components/date-field";
import { Fragment, useId, useState, useTransition } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FormDialog,
  Field,
  FieldMsg,
  fieldProps,
  focusFirstInvalid,
} from "@/components/form-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Aed, BaseCurrency } from "@/components/aed";
import { useWorkspace } from "@/components/workspace-context";
import { hasErrors, validatePo, without, type FieldErrors } from "@/lib/form-validation";
import { lineTotal, PO_STAGES, poTotal, STAGE_LABEL, type PoStage } from "@/lib/procurement";
import { DeleteRecordButton } from "@/components/delete-record";
import {
  createPurchaseOrder,
  purchaseDeletePreview,
  removePurchaseOrder,
  updatePurchaseOrder,
} from "@/app/(app)/procurement/actions";

type LineDraft = {
  key: string;
  id?: string;
  description: string;
  qty: string;
  unitPriceAed: string;
};

export type PoFormValues = {
  id: string;
  vendorName: string;
  requestedOn: string;
  notes: string | null;
  invoiceNumber: string | null;
  vatApplied: boolean;
  discountAed: number;
  project: string | null;
  status: PoStage;
  lines: {
    id: string;
    description: string;
    qty: number;
    unitPriceAed: number;
  }[];
};

const blankLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  description: "",
  qty: "1",
  unitPriceAed: "",
});

export function PoFormDialog({
  open,
  onOpenChange,
  vendors,
  today,
  initial,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendors: string[];
  today: string;
  /** Present when editing; absent when creating. */
  initial?: PoFormValues;
  onSaved: (poNumber?: string) => void;
  /** Editing only: runs after the purchase was deleted from the Delete button. */
  onDeleted?: () => void;
}) {
  const { baseCurrency } = useWorkspace();
  const ids = useId();
  const editing = Boolean(initial);
  const [vendorName, setVendorName] = useState(initial?.vendorName ?? "");
  const [requestedOn, setRequestedOn] = useState(initial?.requestedOn ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [vatApplied, setVatApplied] = useState(initial?.vatApplied ?? false);
  const [discount, setDiscount] = useState(
    initial && initial.discountAed > 0 ? String(initial.discountAed) : "",
  );
  const [project, setProject] = useState(initial?.project ?? "");
  const [status, setStatus] = useState<PoStage>(initial?.status ?? "requested");
  const [lines, setLines] = useState<LineDraft[]>(
    initial
      ? initial.lines.map((l) => ({
          key: l.id,
          id: l.id,
          description: l.description,
          qty: String(l.qty),
          unitPriceAed: String(l.unitPriceAed),
        }))
      : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [removing, setRemoving] = useState<{ key: string; index: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const clear = (...keys: string[]) =>
    setErrors((all) => keys.reduce((next, k) => without(next, k), all));
  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    if ("description" in patch) clear(`line:${key}:description`);
    if ("qty" in patch) clear(`line:${key}:qty`);
    if ("unitPriceAed" in patch) clear(`line:${key}:price`);
  };
  const removeLine = (key: string) => setLines((all) => all.filter((x) => x.key !== key));

  const subtotal = lines.reduce(
    (sum, l) =>
      sum + lineTotal({ qty: Number(l.qty) || 0, unitPriceAed: Number(l.unitPriceAed) || 0 }),
    0,
  );
  const money = poTotal({ subtotal, discount: Number(discount) || 0, vat: vatApplied });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validatePo({ vendorName, requestedOn, discount, subtotal, lines });
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(form);
    setError(null);
    const payload = {
      vendorName,
      requestedOn,
      notes,
      invoiceNumber,
      vatApplied,
      discountAed: discount.trim() ? discount : 0,
      project,
      lines: lines.map((l) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        unitPriceAed: l.unitPriceAed,
      })),
    };
    startTransition(async () => {
      if (initial) {
        const result = await updatePurchaseOrder({ ...payload, id: initial.id, status });
        if (result.ok) onSaved();
        else setError(result.error);
        return;
      }
      const result = await createPurchaseOrder(payload);
      if (result.ok) onSaved(result.data.poNumber);
      else setError(result.error);
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={editing ? "Edit purchase" : "New purchase"}
      description={
        editing
          ? "Changes are recorded in the activity log."
          : "Gets the next PO number. Attach the approval file afterwards to approve it."
      }
      footer={
        <>
          {error ? (
            <p className="alert red sm" role="alert">
              {error}
            </p>
          ) : null}
          {initial && onDeleted ? (
            <DeleteRecordButton
              label="Delete purchase"
              preview={() => purchaseDeletePreview(initial.id)}
              remove={() => removePurchaseOrder(initial.id)}
              onDeleted={onDeleted}
            />
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create purchase"}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
        <div className="form-grid main-aside">
          <Field
            label="Vendor"
            htmlFor={`${ids}-vendor`}
            hint="Pick one, or type a new vendor name."
            error={errors.vendor}
          >
            <input
              id={`${ids}-vendor`}
              className="field"
              list={`${ids}-vendors`}
              value={vendorName}
              onChange={(e) => {
                setVendorName(e.target.value);
                clear("vendor");
              }}
              {...fieldProps(`${ids}-vendor`, errors.vendor)}
              autoFocus={!editing}
            />
            <datalist id={`${ids}-vendors`}>
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label="Requested on" htmlFor={`${ids}-date`} error={errors.date}>
            <DateField
              id={`${ids}-date`}
              className="field"
              value={requestedOn}
              onChange={(e) => {
                setRequestedOn(e.target.value);
                clear("date");
              }}
              {...fieldProps(`${ids}-date`, errors.date)}
            />
          </Field>
        </div>

        <div className="form-grid">
          <Field
            label="Invoice number"
            htmlFor={`${ids}-invno`}
            hint="Added to the invoice file name"
          >
            <input
              id={`${ids}-invno`}
              className="field"
              maxLength={60}
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </Field>
          <Field label="Project" htmlFor={`${ids}-project`} hint="Added to every file name">
            <input
              id={`${ids}-project`}
              className="field"
              maxLength={120}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            />
          </Field>
        </div>

        {editing ? (
          <Field
            label="Stage"
            htmlFor={`${ids}-status`}
            hint="Use this to correct a stage set by mistake."
          >
            <select
              id={`${ids}-status`}
              className="field"
              value={status}
              onChange={(e) => setStatus(e.target.value as PoStage)}
            >
              {PO_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <div className="min-w-0">
          <div className="eyebrow section mb-2">Line items</div>
          <div className="lines" role="table" aria-label="Line items">
            <div className="line-row line-head" role="row">
              <div role="columnheader">Description</div>
              <div className="r" role="columnheader">
                Qty
              </div>
              <div className="r" role="columnheader">
                Unit <BaseCurrency />
              </div>
              <div role="columnheader">
                <span className="sr-only">Remove</span>
              </div>
            </div>
            {lines.map((l, i) => {
              const descId = `${ids}-${l.key}-desc`;
              const qtyId = `${ids}-${l.key}-qty`;
              const priceId = `${ids}-${l.key}-price`;
              const descError = errors[`line:${l.key}:description`];
              const qtyError = errors[`line:${l.key}:qty`];
              const priceError = errors[`line:${l.key}:price`];
              return (
                <Fragment key={l.key}>
                  <div className="line-row" role="row">
                    <input
                      id={descId}
                      className="field"
                      aria-label={`Line ${i + 1} description`}
                      value={l.description}
                      onChange={(e) => setLine(l.key, { description: e.target.value })}
                      {...fieldProps(descId, descError)}
                    />
                    <input
                      id={qtyId}
                      className="field num"
                      type="number"
                      min={1}
                      step={1}
                      aria-label={`Line ${i + 1} quantity`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      {...fieldProps(qtyId, qtyError)}
                    />
                    <input
                      id={priceId}
                      className="field num"
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={`Line ${i + 1} unit price in ${baseCurrency}`}
                      inputMode="decimal"
                      value={l.unitPriceAed}
                      onChange={(e) => setLine(l.key, { unitPriceAed: e.target.value })}
                      {...fieldProps(priceId, priceError)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={lines.length === 1}
                      title="Remove line"
                      onClick={() =>
                        // Nothing typed and never saved: just drop it. Otherwise confirm first.
                        l.id || l.description.trim()
                          ? setRemoving({ key: l.key, index: i })
                          : removeLine(l.key)
                      }
                    >
                      <Trash2Icon size={14} strokeWidth={2} aria-hidden />
                    </Button>
                  </div>
                  {descError || qtyError || priceError ? (
                    <div role="row" className="flex flex-col pb-2">
                      <div role="cell" className="flex flex-col">
                        <FieldMsg id={descId} error={descError} />
                        <FieldMsg id={qtyId} error={qtyError} />
                        <FieldMsg id={priceId} error={priceError} />
                      </div>
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
          <div className="lines-foot">
            <Button size="sm" onClick={() => setLines((all) => [...all, blankLine()])}>
              <PlusIcon size={12} strokeWidth={2} aria-hidden /> Add line
            </Button>
          </div>
          <dl
            className="m-0 ml-auto mt-3 grid w-full max-w-[320px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 text-ink2"
            aria-label="Purchase totals"
            aria-live="polite"
            data-testid="po-summary"
          >
            <dt>Subtotal</dt>
            <dd className="m-0 text-right tabular-nums">
              <Aed value={money.subtotal} />
            </dd>
            <dt>
              <label htmlFor={`${ids}-discount`}>Discount</label>
            </dt>
            <dd className="m-0 flex flex-col items-end">
              <input
                id={`${ids}-discount`}
                className="field num w-[140px]"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Discount in ${baseCurrency}`}
                value={discount}
                onChange={(e) => {
                  setDiscount(e.target.value);
                  clear("discount");
                }}
                {...fieldProps(`${ids}-discount`, errors.discount)}
              />
              <FieldMsg id={`${ids}-discount`} error={errors.discount} />
            </dd>
            <dt>
              <label className="flex items-center gap-2" htmlFor={`${ids}-vat`}>
                <input
                  id={`${ids}-vat`}
                  type="checkbox"
                  checked={vatApplied}
                  onChange={(e) => setVatApplied(e.target.checked)}
                />
                5% VAT
              </label>
            </dt>
            <dd className="m-0 text-right tabular-nums" data-testid="po-vat">
              <Aed value={money.vat} />
            </dd>
            <dt className="fw-600 text-ink">Total</dt>
            <dd
              className="m-0 text-right font-semibold tabular-nums text-ink"
              data-testid="po-total"
            >
              <Aed value={money.total} />
            </dd>
          </dl>
        </div>

        <Field label="Notes" htmlFor={`${ids}-notes`}>
          <textarea
            id={`${ids}-notes`}
            className="field"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>
      {removing ? (
        <ConfirmDialog
          title={`Remove line ${removing.index + 1}?`}
          description={
            lines.find((l) => l.key === removing.key)?.description.trim() ||
            "This line has no description."
          }
          confirmLabel="Remove line"
          onClose={() => setRemoving(null)}
          onConfirm={() => removeLine(removing.key)}
        >
          <p className="m-0 text-ink2">
            {editing
              ? "It is removed from the purchase when you save. Cancel the form to keep it."
              : "It is removed from this draft."}
          </p>
        </ConfirmDialog>
      ) : null}
    </FormDialog>
  );
}
