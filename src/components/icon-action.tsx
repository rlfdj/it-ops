"use client";

import { cloneElement, useState } from "react";
import { DownloadIcon, ExternalLinkIcon, FileXIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { Tooltip } from "radix-ui";
import { DocumentPreviewSheet } from "@/components/documents/document-preview";
import { documentHref } from "@/lib/links";

/**
 * A tooltip that shows on hover and on keyboard focus. `children` is the one trigger element.
 * Radix closes a tooltip when anything scrolls, and focusing a button that sits below the
 * fold scrolls it into view, so the tooltip is also held open while the trigger has keyboard
 * focus.
 */
export function IconTip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const trigger = cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
    // `:active` is true while the mouse button is down on it: a press is not keyboard focus.
    onFocus: (e) => setFocused(!e.currentTarget.matches(":active")),
    onBlur: () => setFocused(false),
    onKeyDown: (e) => {
      if (e.key === "Escape") setFocused(false); // dismissable while focused
    },
  });
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
      <Tooltip.Root open={hovered || focused} onOpenChange={setHovered}>
        <Tooltip.Trigger asChild>{trigger}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="tip" side="top" sideOffset={6}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

const ICON = { size: 14, strokeWidth: 2, "aria-hidden": true } as const;

/**
 * View or Download for a stored document, as an icon button. `what` names it, e.g.
 * "invoice for Sep ’26". View opens the preview sheet (a new tab on phones or with a
 * modified click); `onReplace` adds the sheet's Replace button.
 */
export function DocLink({
  documentId,
  action,
  what,
  fileName,
  onReplace,
}: {
  documentId: string;
  action: "view" | "download";
  what: string;
  fileName?: string;
  onReplace?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const view = action === "view";
  const label = `${view ? "View" : "Download"} ${what}`;
  return (
    <>
      <IconTip label={view ? "View" : "Download"}>
        <a
          className="btn ghost sm icon"
          href={view ? documentHref(documentId) : `${documentHref(documentId)}?download`}
          aria-label={view ? `${label} (opens in a new tab)` : label}
          {...(view ? { target: "_blank", rel: "noreferrer" } : { download: fileName ?? "" })}
          onClick={
            view
              ? (e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  if (!window.matchMedia("(min-width: 761px)").matches) return;
                  e.preventDefault();
                  setOpen(true);
                }
              : undefined
          }
        >
          {view ? <ExternalLinkIcon {...ICON} /> : <DownloadIcon {...ICON} />}
        </a>
      </IconTip>
      {view && open ? (
        <DocumentPreviewSheet
          documentId={documentId}
          fileName={fileName ?? what}
          open
          onOpenChange={setOpen}
          onReplace={
            onReplace
              ? () => {
                  setOpen(false);
                  onReplace();
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

/** The "Change" (replace the file) icon button. */
export function ChangeButton({
  what,
  onClick,
  disabled,
}: {
  what: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconTip label="Change">
      <button
        type="button"
        className="btn ghost sm icon"
        aria-label={`Change ${what}`}
        disabled={disabled}
        onClick={onClick}
      >
        <RefreshCwIcon {...ICON} />
      </button>
    </IconTip>
  );
}

/**
 * "Remove file" (the file only) or "Remove period" (a whole ledger row), as an icon button.
 * The caller shows the confirmation when it is clicked.
 */
export function RemoveButton({
  kind,
  what,
  onClick,
  disabled,
}: {
  kind: "file" | "period";
  what: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const label = kind === "file" ? "Remove file" : "Remove period";
  return (
    <IconTip label={label}>
      <button
        type="button"
        className="btn ghost sm icon danger"
        aria-label={`${label}: ${what}`}
        disabled={disabled}
        onClick={onClick}
      >
        {kind === "file" ? <FileXIcon {...ICON} /> : <Trash2Icon {...ICON} />}
      </button>
    </IconTip>
  );
}
