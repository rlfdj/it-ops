"use client";

import { useId, useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/date-field";
import { Field, FormDialog, fieldProps } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { checkDate } from "@/lib/form-validation";
import { setPurchaseInvoiceDate } from "@/app/(app)/procurement/actions";

/**
 * Asks for the invoice date: when an invoice file is uploaded, and from the purchase panel.
 * The date can be left blank (files then use their own upload dates). `onConfirm` returns an
 * error message to keep the dialog open.
 */
export function InvoiceDateDialog({
  title,
  description,
  fileLine,
  initial,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description?: string;
  fileLine?: string;
  initial: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (date: string) => Promise<string | void>;
}) {
  const id = useId();
  const [date, setDate] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = checkDate(date, "invoice date", false);
    setProblem(found);
    if (found) return;
    setError(null);
    startTransition(async () => {
      const message = await onConfirm(date);
      if (typeof message === "string") setError(message);
      else onClose();
    });
  };
  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : onClose())}
      title={title}
      description={description}
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={pending}>
            {pending ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {fileLine ? (
          <p className="m-0 text-ink2">
            File: <span className="id">{fileLine}</span>
          </p>
        ) : null}
        <Field
          label="Invoice date"
          htmlFor={`${id}-date`}
          hint="Dates all three files (approval, invoice, delivery note). Leave blank to use each upload date."
          error={problem ?? undefined}
        >
          <DateField
            id={`${id}-date`}
            className="field"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setProblem(null);
            }}
            {...fieldProps(`${id}-date`, problem)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}

/** The small "change" button beside the invoice date in the purchase panel. */
export function InvoiceDateEdit({
  poId,
  poNumber,
  invoiceDate,
  today,
}: {
  poId: string;
  poNumber: string;
  invoiceDate: string | null;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Change invoice date"
        title="Change invoice date"
        onClick={() => setOpen(true)}
      >
        <PencilIcon size={13} strokeWidth={2} aria-hidden />
      </Button>
      {open ? (
        <InvoiceDateDialog
          title="Invoice date"
          description={`Dates all three files of ${poNumber}. Changing it renames them.`}
          initial={invoiceDate ?? today}
          confirmLabel="Save date"
          onClose={() => setOpen(false)}
          onConfirm={async (date) => {
            const result = await setPurchaseInvoiceDate({ poId, invoiceDate: date });
            if (!result.ok) return result.error;
            router.refresh();
            toast.show({ text: `Invoice date saved on ${poNumber}` });
          }}
        />
      ) : null}
    </>
  );
}
