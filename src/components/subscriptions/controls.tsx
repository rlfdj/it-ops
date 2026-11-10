"use client";

import { DateField } from "@/components/date-field";
import { useCallback, useId, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { useShortcut } from "@/hooks/use-shortcut";
import { hasErrors, validateInvoice, without, type FieldErrors } from "@/lib/form-validation";
import { checkUpload, UPLOAD_ACCEPT } from "@/lib/uploads";
import { prefillSeats, type SeatSource } from "@/lib/subscription-seats";
import { rosterMismatchNote, seatsForInvoice, type RosterSeat } from "@/lib/seat-roster";
import { newSeatLine, SeatCountFields, SeatListFields, type SeatLine } from "./seat-fields";
import {
  removeInvoiceFile,
  removeInvoicePeriodAction,
  toggleAutoRenew,
  uploadInvoice,
} from "@/app/(app)/subscriptions/actions";
import { ChangeButton, DocLink, RemoveButton } from "@/components/icon-action";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubFormDialog, type SubFormValues } from "./sub-form-dialog";

/** "Only with missing invoices" checkbox, kept in the URL. */
export function MissingToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="cb-row ml-auto text-ink2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.checked) next.set("missing", "1");
          else next.delete("missing");
          next.delete("sub");
          router.replace(`/subscriptions${next.size ? `?${next}` : ""}`, { scroll: false });
        }}
      />
      Only with missing invoices
    </label>
  );
}

/** Opens the New subscription dialog on `?new=1`. */
export function NewSubscription({
  open,
  vendors,
  today,
}: {
  open: boolean;
  vendors: string[];
  today: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  if (!open) return null;
  const close = (id?: string) => {
    const next = new URLSearchParams(params);
    next.delete("new");
    if (id) next.set("sub", id);
    router.replace(`/subscriptions${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  return (
    <SubFormDialog
      open
      onOpenChange={(o) => (o ? null : close())}
      vendors={vendors}
      today={today}
      onSaved={(id) => {
        close(id);
        toast.show({ text: "Subscription created" });
      }}
    />
  );
}

/** Edit button (and E) for the selected subscription. */
export function EditSubscription({
  values,
  vendors,
  today,
}: {
  values: SubFormValues;
  vendors: string[];
  today: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useShortcut(
    useCallback((command) => {
      if (command === "edit") setOpen(true);
    }, []),
  );
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="E"
      >
        Edit<span className="kbd">E</span>
      </Button>
      {open ? (
        <SubFormDialog
          key={values.id}
          open
          onOpenChange={setOpen}
          vendors={vendors}
          today={today}
          initial={values}
          onSaved={() => {
            setOpen(false);
            router.refresh();
            toast.show({ text: `Saved ${values.name}` });
          }}
          onDeleted={() => {
            setOpen(false);
            const next = new URLSearchParams(params);
            next.delete("sub");
            router.replace(`/subscriptions${next.size ? `?${next}` : ""}`, { scroll: false });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** The auto-renew switch in the panel. Saves immediately. */
export function AutoRenewSwitch({
  id,
  name,
  checked,
}: {
  id: string;
  name: string;
  checked: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Follow the server's value after a refresh (instead of re-keying, which would drop focus).
  const [seen, setSeen] = useState(checked);
  if (checked !== seen) {
    setSeen(checked);
    setOn(checked);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        className="sw"
        aria-label="Auto-renew"
        checked={on}
        // aria-busy, not disabled: a disabled control loses keyboard focus (WCAG 2.4.3).
        aria-busy={pending}
        onChange={(e) => {
          if (pending) return;
          const next = e.target.checked;
          setOn(next);
          startTransition(async () => {
            const result = await toggleAutoRenew(id, next);
            if (!result.ok) {
              setOn(!next);
              setError(result.error);
            } else {
              setError(null);
              router.refresh();
              toast.show({
                text: `Auto-renew ${next ? "on" : "off"} for ${name}`,
                // Sets the opposite state explicitly, so a repeat does nothing more.
                undo: async () => {
                  const undone = await toggleAutoRenew(id, !next);
                  if (undone.ok) {
                    setOn(!next);
                    router.refresh();
                  }
                  return undone;
                },
              });
            }
          });
        }}
      />
      <span className="muted text-[12px]">{on ? "On" : "Off"}</span>
      {error ? (
        <span className="alert red sm" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Upload (or replace) the invoice file for one ledger row. Drag a file onto the row,
 * or click the button. Optionally records the invoice number and amount.
 */
export function InvoiceUpload({
  invoiceId,
  periodLabel,
  currency,
  amount,
  seatCounts,
  roster,
  periodStart,
  replace,
  documentId,
  documentName,
}: {
  invoiceId: string;
  periodLabel: string;
  currency: string;
  /** The amount on the row (the expected cost for a period without an invoice), if any. */
  amount: number | null;
  /** Renewal invoices of tiered subscriptions: the Standard / Premium counts to start from. */
  seatCounts: { standard: number; premium: number } | null;
  /** The seat roster, to flag counts that differ from it. */
  roster?: RosterSeat[];
  periodStart?: string;
  replace: boolean;
  /** The file on file (when `replace`): shown as View / Change / Download icons. */
  documentId?: string | null;
  documentName?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [value, setValue] = useState(amount == null ? "" : String(amount));
  const [typedCounts, setTypedCounts] = useState<{ standard: string; premium: string } | null>(
    null,
  );
  const counts = typedCounts ?? {
    standard: String(seatCounts?.standard ?? 0),
    premium: String(seatCounts?.premium ?? 0),
  };
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const mismatch =
    seatCounts && roster && periodStart
      ? rosterMismatchNote(roster, periodStart, {
          standard: Number(counts.standard) || 0,
          premium: Number(counts.premium) || 0,
        })
      : null;

  const choose = (f: File | undefined) => {
    if (!f) return;
    const problem = checkUpload(f);
    if (problem) {
      setError(problem);
      setFile(null);
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) return;
    const found = validateInvoice({ amount: value, counts: seatCounts ? counts : undefined });
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(event.currentTarget);
    const form = new FormData();
    form.set("invoiceId", invoiceId);
    form.set("file", file);
    form.set("invoiceNumber", invoiceNumber);
    form.set("amount", value);
    if (seatCounts) {
      form.set("seatsStandard", counts.standard);
      form.set("seatsPremium", counts.premium);
    }
    startTransition(async () => {
      const result = await uploadInvoice(form);
      if (!result.ok) setError(result.error);
      else {
        setFile(null);
        setErrors({});
        router.refresh();
        toast.show({
          text: replace
            ? `Invoice for ${periodLabel} replaced`
            : `Invoice for ${periodLabel} attached`,
        });
      }
    });
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <span
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          choose(e.dataTransfer.files[0]);
        }}
      >
        {replace ? (
          <>
            {documentId ? (
              <DocLink
                documentId={documentId}
                action="view"
                what={`invoice for ${periodLabel}`}
                fileName={documentName ?? undefined}
                onReplace={() => input.current?.click()}
              />
            ) : null}
            <ChangeButton
              what={`invoice for ${periodLabel}`}
              onClick={() => input.current?.click()}
            />
            {documentId ? (
              <DocLink
                documentId={documentId}
                action="download"
                what={`invoice for ${periodLabel}`}
              />
            ) : null}
          </>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Upload invoice for ${periodLabel}`}
            onClick={() => input.current?.click()}
          >
            Upload
          </Button>
        )}
      </span>
      {file || (error && !file) ? (
        <FormDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setFile(null);
              setError(null);
            }
          }}
          title={replace ? `Replace invoice for ${periodLabel}?` : `Invoice for ${periodLabel}`}
          description={
            replace
              ? `The invoice on file is deleted and can’t be recovered. New file: ${file?.name ?? ""}`
              : file
                ? file.name
                : undefined
          }
          footer={
            <>
              {error ? (
                <p className="alert red sm mr-auto self-center" role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={replace ? "danger" : "primary"}
                type="submit"
                form={`${ids}-form`}
                disabled={pending || !file}
              >
                {pending ? "Uploading…" : replace ? "Replace invoice" : "Attach invoice"}
              </Button>
            </>
          }
        >
          <form
            id={`${ids}-form`}
            noValidate
            onSubmit={submit}
            className="grid gap-4 sm:grid-cols-2"
          >
            <Field label="Invoice number" htmlFor={`${ids}-no`} hint="Optional.">
              <input
                id={`${ids}-no`}
                className="field font-mono text-[12px]"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                autoFocus
              />
            </Field>
            <Field
              label={`Amount (${currency})`}
              htmlFor={`${ids}-amt`}
              hint="Required. The total on the invoice."
              error={errors.amount}
            >
              <input
                id={`${ids}-amt`}
                className="field text-right"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setErrors((all) => without(all, "amount"));
                }}
                {...fieldProps(`${ids}-amt`, errors.amount)}
              />
            </Field>
            {seatCounts ? (
              <SeatCountFields
                ids={ids}
                standard={counts.standard}
                premium={counts.premium}
                onChange={(next) => {
                  setTypedCounts(next);
                  setErrors((all) => without(without(all, "seatsStandard"), "seatsPremium"));
                }}
                errors={errors}
                note={mismatch}
              />
            ) : null}
          </form>
        </FormDialog>
      ) : null}
    </>
  );
}

/** "Add invoice": a ledger row for a period that isn't listed, optionally with its file. */
export function AddInvoice({
  subscriptionId,
  billingCycle,
  currency,
  amount,
  today,
  preset,
  seatSources,
  seatFallback,
  roster,
  people,
}: {
  subscriptionId: string;
  billingCycle: "monthly" | "yearly";
  currency: string;
  /** The expected cost, offered as the renewal amount; null when the bill varies. */
  amount: number | null;
  today: string;
  /** Tiered subscriptions: renewal invoices carry Standard and Premium counts. */
  preset: boolean;
  seatSources: SeatSource[];
  seatFallback: { standard: number | null; premium: number | null };
  /** The seat roster: the pre-fill follows it, and typed counts that differ get a note. */
  roster: RosterSeat[];
  /** Names for the pro-rated seat list suggestions. */
  people: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"renewal" | "prorated">("renewal");
  const [periodStart, setPeriodStart] = useState(today);
  const [seats, setSeats] = useState<SeatLine[]>(() => [newSeatLine()]);
  const [typedCounts, setTypedCounts] = useState<{ standard: string; premium: string } | null>(
    null,
  );
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const amountText = amount == null ? "" : String(amount);
  const [value, setValue] = useState(amountText);
  // Standard / Premium start from the last renewal invoice plus the seats added since.
  const suggested = seatsForInvoice(roster, periodStart, () =>
    prefillSeats(seatSources, seatFallback, periodStart),
  );
  const counts = typedCounts ?? {
    standard: String(suggested.standard),
    premium: String(suggested.premium),
  };
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const prorated = type === "prorated";
  const mismatch = rosterMismatchNote(roster, periodStart, {
    standard: Number(counts.standard) || 0,
    premium: Number(counts.premium) || 0,
  });
  const renewalName = billingCycle === "yearly" ? "Yearly renewal" : "Monthly renewal";

  const choose = (next: "renewal" | "prorated") => {
    setType(next);
    // A pro-rated amount is entered by hand; a renewal starts from the expected cost.
    setValue(next === "prorated" ? "" : amountText);
    setErrors({});
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateInvoice({
      periodStart,
      amount: value,
      counts: !prorated && preset ? counts : undefined,
      seats: prorated ? seats : undefined,
    });
    if (file) {
      const problem = checkUpload(file);
      if (problem) found.file = problem;
    }
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(event.currentTarget);
    setError(null);
    const form = new FormData();
    form.set("subscriptionId", subscriptionId);
    form.set("kind", type);
    form.set("periodStart", periodStart);
    if (prorated)
      form.set(
        "seats",
        JSON.stringify(
          seats.map((s) => ({ personName: s.personName, tier: s.tier, project: s.project })),
        ),
      );
    else if (preset) {
      form.set("seatsStandard", counts.standard);
      form.set("seatsPremium", counts.premium);
    }
    form.set("invoiceNumber", invoiceNumber);
    form.set("amount", value);
    if (file) form.set("file", file);
    startTransition(async () => {
      const result = await uploadInvoice(form);
      if (!result.ok) setError(result.error);
      else {
        setOpen(false);
        setFile(null);
        setInvoiceNumber("");
        setSeats([newSeatLine()]);
        setTypedCounts(null);
        setType("renewal");
        setValue(amountText);
        setErrors({});
        router.refresh();
        toast.show({
          text: file
            ? `${prorated ? "Pro-rated invoice" : "Invoice"} added and attached`
            : prorated
              ? "Pro-rated invoice added"
              : "Invoice period added",
        });
      }
    });
  };

  return (
    <>
      <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}>
        Add invoice
      </Button>
      {open ? (
        <FormDialog
          open
          onOpenChange={setOpen}
          wide={prorated}
          title="Add invoice"
          description={
            prorated
              ? "An extra charge for one or more seats, e.g. a seat added mid-cycle."
              : "For a billing period that isn't in the ledger yet."
          }
          footer={
            <>
              {error ? (
                <p className="alert red sm mr-auto self-center" role="alert">
                  {error}
                </p>
              ) : null}
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
                {pending ? "Saving…" : "Add invoice"}
              </Button>
            </>
          }
        >
          <form
            id={`${ids}-form`}
            onSubmit={submit}
            noValidate
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <span className="eyebrow" id={`${ids}-type`}>
                Type
              </span>
              <div className="seg mt-1.5" role="group" aria-labelledby={`${ids}-type`}>
                {(
                  [
                    ["renewal", renewalName],
                    ["prorated", "Pro-rated"],
                  ] as const
                ).map(([key, text]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={type === key}
                    onClick={() => choose(key)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            {prorated ? (
              <SeatListFields
                ids={ids}
                seats={seats}
                onChange={setSeats}
                people={people}
                errors={errors}
                clearError={(key) => setErrors((all) => without(all, key))}
              />
            ) : null}
            <Field
              label="Charge date"
              htmlFor={`${ids}-date`}
              hint={prorated ? undefined : "Any date in the billing period."}
              error={errors.periodStart}
            >
              <DateField
                id={`${ids}-date`}
                className="field"
                value={periodStart}
                onChange={(e) => {
                  setPeriodStart(e.target.value);
                  setErrors((all) => without(all, "periodStart"));
                }}
                {...fieldProps(`${ids}-date`, errors.periodStart)}
              />
            </Field>
            <Field label={`Amount (${currency})`} htmlFor={`${ids}-amt`} error={errors.amount}>
              <input
                id={`${ids}-amt`}
                className="field text-right"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setErrors((all) => without(all, "amount"));
                }}
                {...fieldProps(`${ids}-amt`, errors.amount)}
              />
            </Field>
            {!prorated && preset ? (
              <SeatCountFields
                ids={ids}
                standard={counts.standard}
                premium={counts.premium}
                onChange={(next) => {
                  setTypedCounts(next);
                  setErrors((all) => without(without(all, "seatsStandard"), "seatsPremium"));
                }}
                errors={errors}
                note={mismatch}
              />
            ) : null}
            <Field label="Invoice number" htmlFor={`${ids}-no`} hint="Optional.">
              <input
                id={`${ids}-no`}
                className="field font-mono text-[12px]"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </Field>
            <Field
              label="File"
              htmlFor={`${ids}-file`}
              hint="Optional — PDF or image, up to 25 MB."
              error={errors.file}
            >
              <input
                id={`${ids}-file`}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="text-[12px]"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setErrors((all) => without(all, "file"));
                }}
                {...fieldProps(`${ids}-file`, errors.file)}
              />
            </Field>
          </form>
        </FormDialog>
      ) : null}
    </>
  );
}

/**
 * "Remove file" and "Remove period" for one ledger row. Removing the file sends the period
 * back to missing or upcoming; removing the period hides it for good (it is not generated
 * again) and deletes its file too.
 */
export function InvoiceRemove({
  invoiceId,
  label,
  prorated,
  documentName,
}: {
  invoiceId: string;
  /** The period as the ledger shows it, e.g. "Nov ’26". */
  label: string;
  prorated: boolean;
  /** The file on file, if any. */
  documentName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState<"file" | "period" | null>(null);
  return (
    <>
      {documentName ? (
        <RemoveButton kind="file" what={`invoice for ${label}`} onClick={() => setAsking("file")} />
      ) : null}
      <RemoveButton kind="period" what={label} onClick={() => setAsking("period")} />
      {asking === "file" ? (
        <ConfirmDialog
          title={`Remove the invoice file for ${label}?`}
          description={`${documentName} is deleted and can’t be recovered. The period stays in the ledger as missing.`}
          confirmLabel="Remove file"
          pendingLabel="Removing…"
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const result = await removeInvoiceFile(invoiceId);
            if (!result.ok) return result.error;
            router.refresh();
            toast.show({ text: `Removed the invoice file for ${label}` });
          }}
        />
      ) : null}
      {asking === "period" ? (
        <ConfirmDialog
          title={`Remove ${label} from the ledger?`}
          description={`It won’t come back.${
            prorated
              ? ""
              : " If the dates are wrong, fix the subscription’s Next charge date instead."
          }${documentName ? ` Its file ${documentName} is deleted too.` : ""}`}
          confirmLabel="Remove period"
          pendingLabel="Removing…"
          onClose={() => setAsking(null)}
          onConfirm={async () => {
            const result = await removeInvoicePeriodAction(invoiceId);
            if (!result.ok) return result.error;
            router.refresh();
            toast.show({ text: `Removed ${label} from the ledger` });
          }}
        />
      ) : null}
    </>
  );
}
