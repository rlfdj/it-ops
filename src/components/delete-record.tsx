"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/shell/toast";
import type { DeleteConfirm } from "@/lib/delete-confirm";
import type { ActionResult } from "@/lib/uploads";

/**
 * The "Delete …" button at the bottom-left of a record's Edit dialog. Opening it fetches the
 * live counts and shows the one confirmation that names exactly what goes with the record.
 * `onDeleted` runs after the delete succeeds: close the dialog, drop the record from the URL
 * and refresh. The "Deleted …" toast is shown here.
 */
export function DeleteRecordButton({
  label,
  preview,
  remove,
  onDeleted,
  className = "mr-auto",
}: {
  /** The button text, e.g. "Delete subscription". */
  label: string;
  preview: () => Promise<ActionResult<DeleteConfirm>>;
  remove: () => Promise<ActionResult<{ name: string }>>;
  onDeleted: () => void;
  /** Default `mr-auto`: bottom-left of a dialog footer. */
  className?: string;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<DeleteConfirm | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="ghost"
        className={`danger ${className}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await preview();
            if (result.ok) setConfirm(result.data);
            else toast.show({ tone: "red", text: result.error });
          })
        }
      >
        {pending ? "Checking…" : label}
      </Button>
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const result = await remove();
            if (!result.ok) return result.error;
            onDeleted();
            toast.show({ text: `Deleted ${result.data.name}` });
          }}
        />
      ) : null}
    </>
  );
}
