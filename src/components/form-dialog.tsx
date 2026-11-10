"use client";

import type { ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The dialog shell for forms: a fixed header, a scrolling body and a footer that never
 * scrolls (F004). Below 640px it becomes a bottom sheet with full-width buttons.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
  wider = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Even wider (about 960px) for dialogs with several fields side by side. */
  wider?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`dialog-shell flex max-h-[calc(var(--vh100)-2rem)] flex-col gap-0 overflow-hidden p-0 ${wider ? "sm:max-w-[960px]" : wide ? "sm:max-w-[760px]" : "sm:max-w-[520px]"} max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-h-[calc(var(--vh100)-24px)] max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:border-b-0`}
      >
        <DialogHeader className="flex-none gap-1 py-6 pr-14 pb-0 pl-6">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex min-h-0 flex-auto flex-col gap-4 overflow-y-auto px-6 pt-4 pb-5">
          {children}
        </div>
        {footer ? <div className="dialog-foot">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}

/** a11y attributes for a control whose message is rendered by `Field` / `FieldMsg`. */
export function fieldProps(id: string, error?: string | null) {
  return error
    ? ({ "aria-invalid": true, "aria-describedby": `${id}-msg` } as const)
    : ({} as Record<string, never>);
}

/** An inline error under a control (red text with an icon). `id` is the control's id. */
export function FieldMsg({ id, error }: { id: string; error?: string | null }) {
  if (!error) return null;
  return (
    <span id={`${id}-msg`} className="field-msg whitespace-normal">
      <CircleAlertIcon className="ico" aria-hidden />
      {error}
    </span>
  );
}

/** Moves focus to the first invalid control of a form after a failed submit. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  window.setTimeout(() => form?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
}

/**
 * A label, its control and a message slot. The message is the validation error when there
 * is one (and `htmlFor` names the control so `fieldProps` can point at it), else the hint.
 */
export function Field({
  label,
  htmlFor,
  children,
  hint,
  error,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <div className="fieldset">
      <label htmlFor={htmlFor} className="lbl">
        {label}
      </label>
      {children}
      {error && htmlFor ? (
        <FieldMsg id={htmlFor} error={error} />
      ) : hint ? (
        <span className="cap">{hint}</span>
      ) : null}
    </div>
  );
}
