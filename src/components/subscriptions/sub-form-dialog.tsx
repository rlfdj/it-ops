"use client";

import { DateField } from "@/components/date-field";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { hasErrors, validateSub, without, type FieldErrors } from "@/lib/form-validation";
import { useWorkspace } from "@/components/workspace-context";
import { formatMoney } from "@/lib/format";
import { DeleteRecordButton } from "@/components/delete-record";
import {
  removeSubscription,
  saveNewSubscription,
  saveSubscription,
  subscriptionDeletePreview,
} from "@/app/(app)/subscriptions/actions";

export type SubFormValues = {
  id: string;
  name: string;
  vendorName: string;
  kind: "subscription" | "contract";
  plan: string | null;
  seats: number | null;
  billingCycle: "monthly" | "yearly";
  /** The expected cost per period; null when the bill varies. */
  costOriginal: number | null;
  currency: string;
  paidBy: string | null;
  userName: string | null;
  project: string | null;
  nextChargeDate: string | null;
  contractEndDate: string | null;
  autoRenew: boolean;
  active: boolean;
  tieredSeats: boolean;
};

export function SubFormDialog({
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
  initial?: SubFormValues;
  onSaved: (id?: string) => void;
  /** Editing only: runs after the subscription was deleted from the Delete button. */
  onDeleted?: () => void;
}) {
  const ids = useId();
  const { usdAedRate: USD_AED, baseCurrency } = useWorkspace();
  const [v, setV] = useState({
    name: initial?.name ?? "",
    vendorName: initial?.vendorName ?? "",
    kind: initial?.kind ?? ("subscription" as SubFormValues["kind"]),
    plan: initial?.plan ?? "",
    seats: initial?.seats == null ? "" : String(initial.seats),
    billingCycle: initial?.billingCycle ?? ("monthly" as SubFormValues["billingCycle"]),
    costOriginal: initial?.costOriginal == null ? "" : String(initial.costOriginal),
    currency: initial?.currency === "USD" ? "USD" : baseCurrency,
    paidBy: initial?.paidBy ?? "",
    userName: initial?.userName ?? "",
    project: initial?.project ?? "",
    nextChargeDate: initial?.nextChargeDate ?? today,
    contractEndDate: initial?.contractEndDate ?? "",
    autoRenew: initial?.autoRenew ?? true,
    active: initial?.active ?? true,
    tieredSeats: initial?.tieredSeats ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setV((all) => ({ ...all, [key]: value }));
    // Editing a field clears its message; the contract end date also depends on the type.
    setErrors((all) => without(without(all, key), key === "kind" ? "contractEndDate" : key));
  };

  const preset = v.tieredSeats;

  const cost = Number(v.costOriginal) || 0;
  const aedPreview =
    v.costOriginal.trim() !== "" && v.currency === "USD" && baseCurrency !== "USD"
      ? Math.round(cost * USD_AED * 100) / 100
      : null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validateSub(v);
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(form);
    setError(null);
    const payload = {
      ...v,
      currency: v.currency,
      // Tiered subscriptions have no plan or seats on the subscription: the server leaves them alone.
      plan: preset ? "" : v.plan,
      seats: preset ? "" : v.seats,
      contractEndDate: v.contractEndDate || null,
    };
    startTransition(async () => {
      if (initial) {
        const result = await saveSubscription({ ...payload, id: initial.id });
        if (result.ok) onSaved();
        else setError(result.error);
        return;
      }
      const result = await saveNewSubscription(payload);
      if (result.ok) onSaved(result.data.id);
      else setError(result.error);
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={initial ? "Edit subscription" : "New subscription"}
      description="A recurring charge or a fixed-term contract. Invoices are tracked for every billing period."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          {initial && onDeleted ? (
            <DeleteRecordButton
              label="Delete subscription"
              preview={() => subscriptionDeletePreview(initial.id)}
              remove={() => removeSubscription(initial.id)}
              onDeleted={onDeleted}
            />
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Saving…" : initial ? "Save changes" : "Create subscription"}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${ids}-name`} error={errors.name}>
          <input
            id={`${ids}-name`}
            className="field"
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            {...fieldProps(`${ids}-name`, errors.name)}
            autoFocus={!initial}
          />
        </Field>
        <Field
          label="Vendor"
          htmlFor={`${ids}-vendor`}
          hint="Pick one, or type a new vendor."
          error={errors.vendorName}
        >
          <input
            id={`${ids}-vendor`}
            className="field"
            list={`${ids}-vendors`}
            value={v.vendorName}
            onChange={(e) => set("vendorName", e.target.value)}
            {...fieldProps(`${ids}-vendor`, errors.vendorName)}
          />
          <datalist id={`${ids}-vendors`}>
            {vendors.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label="Type" htmlFor={`${ids}-kind`}>
          <select
            id={`${ids}-kind`}
            className="field"
            value={v.kind}
            onChange={(e) => set("kind", e.target.value as SubFormValues["kind"])}
          >
            <option value="subscription">Subscription</option>
            <option value="contract">Contract</option>
          </select>
        </Field>
        {preset ? null : (
          <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-3">
            <Field label="Plan" htmlFor={`${ids}-plan`}>
              <input
                id={`${ids}-plan`}
                className="field"
                value={v.plan}
                onChange={(e) => set("plan", e.target.value)}
              />
            </Field>
            <Field label="Seats" htmlFor={`${ids}-seats`} error={errors.seats}>
              <input
                id={`${ids}-seats`}
                className="field text-right"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={v.seats}
                onChange={(e) => set("seats", e.target.value)}
                {...fieldProps(`${ids}-seats`, errors.seats)}
              />
            </Field>
          </div>
        )}
        <Field label="Billing" htmlFor={`${ids}-cycle`}>
          <select
            id={`${ids}-cycle`}
            className="field"
            value={v.billingCycle}
            onChange={(e) => set("billingCycle", e.target.value as SubFormValues["billingCycle"])}
          >
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field
          label="Expected cost"
          htmlFor={`${ids}-cost`}
          hint={
            aedPreview !== null
              ? `≈ ${baseCurrency} ${formatMoney(aedPreview)} at ${USD_AED}`
              : "For fixed contracts; leave blank when the bill varies."
          }
          error={errors.costOriginal}
        >
          <div className="flex gap-2">
            <select
              aria-label="Currency"
              className="field w-[84px]!"
              value={v.currency}
              onChange={(e) => set("currency", e.target.value)}
            >
              <option value={baseCurrency}>{baseCurrency}</option>
              {baseCurrency !== "USD" ? <option value="USD">USD</option> : null}
            </select>
            <input
              id={`${ids}-cost`}
              className="field text-right"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={v.costOriginal}
              onChange={(e) => set("costOriginal", e.target.value)}
              {...fieldProps(`${ids}-cost`, errors.costOriginal)}
            />
          </div>
        </Field>
        <Field
          label="Next charge"
          htmlFor={`${ids}-next`}
          hint={v.billingCycle === "yearly" ? "Also the renewal date." : "Sets the billing day."}
          error={errors.nextChargeDate}
        >
          <DateField
            id={`${ids}-next`}
            className="field"
            value={v.nextChargeDate}
            onChange={(e) => set("nextChargeDate", e.target.value)}
            {...fieldProps(`${ids}-next`, errors.nextChargeDate)}
          />
        </Field>
        <Field
          label="Contract ends"
          htmlFor={`${ids}-end`}
          hint={v.kind === "contract" ? "Required for contracts." : "Optional."}
          error={errors.contractEndDate}
        >
          <DateField
            id={`${ids}-end`}
            className="field"
            value={v.contractEndDate}
            onChange={(e) => set("contractEndDate", e.target.value)}
            {...fieldProps(`${ids}-end`, errors.contractEndDate)}
          />
        </Field>
        <Field label="User" htmlFor={`${ids}-user`} hint="Optional. Added to invoice file names.">
          <input
            id={`${ids}-user`}
            className="field"
            placeholder="e.g. Alex Morgan"
            value={v.userName}
            onChange={(e) => set("userName", e.target.value)}
          />
        </Field>
        <Field
          label="Project"
          htmlFor={`${ids}-project`}
          hint="Optional. Used in file names when there is no user."
        >
          <input
            id={`${ids}-project`}
            className="field"
            placeholder="e.g. Bidding"
            value={v.project}
            onChange={(e) => set("project", e.target.value)}
          />
        </Field>
        <Field label="Paid by" htmlFor={`${ids}-paid`}>
          <input
            id={`${ids}-paid`}
            className="field"
            placeholder="e.g. Corporate card · Acme"
            value={v.paidBy}
            onChange={(e) => set("paidBy", e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-6 pt-5">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              className="sw"
              checked={v.autoRenew}
              onChange={(e) => set("autoRenew", e.target.checked)}
            />
            Auto-renew
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              role="switch"
              className="sw"
              checked={v.tieredSeats}
              onChange={(e) => set("tieredSeats", e.target.checked)}
            />
            Standard / Premium seats
          </label>
          {initial ? (
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                role="switch"
                className="sw"
                checked={v.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              Active
            </label>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}
