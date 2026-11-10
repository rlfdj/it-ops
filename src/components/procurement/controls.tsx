"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shell/toast";
import { useShortcut } from "@/hooks/use-shortcut";
import { advancePurchaseOrder } from "@/app/(app)/procurement/actions";
import { ADVANCE_LABEL, STAGE_LABEL, type PoStage } from "@/lib/procurement";
import { PoFormDialog, type PoFormValues } from "./po-form-dialog";

/** "Only missing documents" checkbox, kept in the URL. */
export function MissingToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
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
          next.delete("po");
          router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
        }}
      />
      <span>Only missing documents</span>
    </label>
  );
}

/** Opens the New purchase dialog when the URL has `?new=1` (top-bar New button or N). */
export function NewPurchase({
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
  const close = (poNumber?: string) => {
    const next = new URLSearchParams(params);
    next.delete("new");
    if (poNumber) next.set("po", poNumber);
    router.replace(`/procurement${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  if (!open) return null;
  return (
    <PoFormDialog
      key="new"
      open
      onOpenChange={(o) => (o ? null : close())}
      vendors={vendors}
      today={today}
      onSaved={(poNumber) => {
        close(poNumber);
        toast.show({ text: poNumber ? `Created ${poNumber}` : "Purchase created" });
      }}
    />
  );
}

/** Edit button (and the E shortcut) for the selected PO. */
export function EditPurchase({
  values,
  poNumber,
  vendors,
  today,
}: {
  values: PoFormValues;
  poNumber: string;
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
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-keyshortcuts="E">
        Edit<span className="kbd">E</span>
      </Button>
      {open ? (
        <PoFormDialog
          key={values.id}
          open
          onOpenChange={setOpen}
          vendors={vendors}
          today={today}
          initial={values}
          onSaved={() => {
            setOpen(false);
            router.refresh();
            toast.show({ text: `Saved ${poNumber}` });
          }}
          onDeleted={() => {
            setOpen(false);
            const next = new URLSearchParams(params);
            next.delete("po");
            router.replace(`/procurement${next.size ? `?${next}` : ""}`, { scroll: false });
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Moves the PO to its next stage (approved → ordered → delivered → closed). */
export function AdvanceStage({
  poId,
  poNumber,
  to,
  blockedReason,
}: {
  poId: string;
  poNumber: string;
  to: PoStage;
  /** Why this step can't be taken yet (e.g. documents missing before closing). */
  blockedReason?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-3">
      <Button
        size="sm"
        disabled={pending || Boolean(blockedReason)}
        aria-describedby={blockedReason ? `${poId}-blocked` : undefined}
        onClick={() =>
          startTransition(async () => {
            const result = await advancePurchaseOrder(poId, to);
            if (!result.ok) setError(result.error);
            else {
              setError(null);
              router.refresh();
              toast.show({ text: `${poNumber} moved to ${STAGE_LABEL[to]}` });
            }
          })
        }
      >
        {pending ? "Saving…" : ADVANCE_LABEL[to]}
      </Button>
      {blockedReason && !error ? (
        <span id={`${poId}-blocked`} className="text-[12px] text-ink3">
          {blockedReason}
        </span>
      ) : null}
      {error ? (
        <span className="alert red sm" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
