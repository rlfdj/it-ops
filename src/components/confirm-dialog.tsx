"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";

/**
 * The one confirmation for every destructive action (B-03): the title names the record,
 * the confirm button is red when `destructive`, and Cancel is focused so Enter never
 * destroys data by accident.
 *
 * `onConfirm` may be async; the dialog stays open and shows the returned error message
 * (return a string to show it, anything else closes the dialog via `onClose`).
 */
export function ConfirmDialog({
  title,
  description,
  children,
  confirmLabel,
  pendingLabel = "Working…",
  destructive = true,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  /** Return an error message to keep the dialog open and show it. */
  onConfirm: () => Promise<string | void> | string | void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
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
          <Button variant="ghost" autoFocus disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const message = await onConfirm();
                if (typeof message === "string") setError(message);
                else onClose();
              })
            }
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? null}
    </FormDialog>
  );
}
