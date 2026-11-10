"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChangeButton, DocLink, RemoveButton } from "@/components/icon-action";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/shell/toast";
import { attachPoDocument, removePoFile } from "@/app/(app)/procurement/actions";
import { checkUpload, UPLOAD_ACCEPT } from "@/lib/uploads";
import { formatBytes } from "@/lib/format";
import { InvoiceDateDialog } from "./invoice-date-dialog";
import { DOC_LABEL, type DocState, type PoDocKind } from "@/lib/procurement";

type Doc = { id: string; fileName: string; originalName: string | null; sizeBytes: number };

/**
 * One document slot on a PO (invoice, delivery note or approval).
 * Accepts drag-and-drop anywhere on the row, or a file picker.
 */
export function DocSlot({
  poId,
  poNumber,
  invoiceDate,
  today,
  kind,
  state,
  doc,
  notNeededUntil,
}: {
  poId: string;
  poNumber: string;
  /** The purchase's invoice date (asked for again when the invoice is uploaded). */
  invoiceDate: string | null;
  today: string;
  kind: PoDocKind;
  state: DocState;
  doc?: Doc;
  notNeededUntil: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ tone: "red"; text: string } | null>(null);
  /** A file waiting for the go-ahead to replace the one on file (the old file is deleted). */
  const [replacing, setReplacing] = useState<File | null>(null);
  /** An invoice file waiting for its invoice date. */
  const [dating, setDating] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const [pending, startTransition] = useTransition();

  /** Uploads and records the file. Returns an error message, or nothing on success. */
  const send = async (file: File, date?: string): Promise<string | void> => {
    const form = new FormData();
    form.set("poId", poId);
    form.set("kind", kind);
    form.set("file", file);
    if (date !== undefined) form.set("invoiceDate", date);
    const result = await attachPoDocument(form);
    if (!result.ok) return result.error;
    router.refresh();
    toast.show({
      text: result.data.approved
        ? `${DOC_LABEL[kind]} attached · ${poNumber} moved to Approved`
        : `${DOC_LABEL[kind]} ${doc ? "replaced" : "attached"} on ${poNumber}`,
    });
  };

  const upload = (file: File) => {
    const problem = checkUpload(file);
    if (problem) {
      setMessage({ tone: "red", text: problem });
      return;
    }
    setMessage(null);
    if (kind === "invoice") {
      setDating(file);
      return;
    }
    if (state === "ok" && doc) {
      setReplacing(file);
      return;
    }
    startTransition(async () => {
      const error = await send(file);
      if (error) setMessage({ tone: "red", text: error });
    });
  };

  const missText =
    kind === "approval" ? "Missing — attach to approve" : "Missing — drop file or browse";

  return (
    <div
      className="slot"
      data-dragging={dragging}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) upload(file);
      }}
    >
      <span>{DOC_LABEL[kind]}</span>

      <span className="flex min-w-0 flex-col gap-1">
        {pending ? (
          <span className="drop neutral">Uploading…</span>
        ) : state === "ok" && doc ? (
          <span className="doc">
            <span className="mark ok" aria-label="Attached" />
            <span className="file" title={doc.fileName}>
              <span className="trunc truncate">{doc.fileName}</span>
            </span>
            <span className="file-size">{formatBytes(doc.sizeBytes)}</span>
          </span>
        ) : state === "miss" ? (
          <button
            type="button"
            className="drop"
            disabled={pending}
            onClick={() => input.current?.click()}
          >
            <PaperclipIcon size={13} strokeWidth={2} aria-hidden />
            {missText}
          </button>
        ) : (
          <span className="text-ink3">Not needed until {notNeededUntil}</span>
        )}
        {message ? (
          <span className="alert red sm" role="alert">
            {message.text}
          </span>
        ) : null}
      </span>

      <span>
        <input
          ref={input}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) upload(file);
          }}
        />
        {state === "ok" && doc ? (
          <span className="acts inline-flex gap-1">
            <DocLink
              documentId={doc.id}
              action="view"
              what={DOC_LABEL[kind].toLowerCase()}
              fileName={doc.fileName}
              onReplace={() => input.current?.click()}
            />
            <ChangeButton
              what={DOC_LABEL[kind].toLowerCase()}
              disabled={pending}
              onClick={() => input.current?.click()}
            />
            <DocLink documentId={doc.id} action="download" what={DOC_LABEL[kind].toLowerCase()} />
            <RemoveButton
              kind="file"
              what={DOC_LABEL[kind].toLowerCase()}
              disabled={pending}
              onClick={() => setRemoving(true)}
            />
          </span>
        ) : (
          <Button
            size="sm"
            variant={state === "miss" ? "secondary" : "ghost"}
            disabled={pending}
            onClick={() => input.current?.click()}
            aria-label={`Upload ${DOC_LABEL[kind].toLowerCase()}`}
          >
            Upload
          </Button>
        )}
      </span>
      {removing && doc ? (
        <ConfirmDialog
          title={`Remove the ${DOC_LABEL[kind].toLowerCase()}?`}
          description={`${doc.fileName} will be deleted from ${poNumber} and can’t be recovered. The slot shows Missing again.`}
          confirmLabel="Remove file"
          pendingLabel="Removing…"
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const result = await removePoFile({ poId, kind });
            if (!result.ok) return result.error;
            router.refresh();
            toast.show({ text: `${DOC_LABEL[kind]} removed from ${poNumber}` });
          }}
        />
      ) : null}
      {dating ? (
        <InvoiceDateDialog
          title={doc ? "Replace the invoice?" : "Upload the invoice"}
          description={
            doc
              ? `${doc.fileName} will be deleted from ${poNumber} and can’t be recovered.`
              : `The invoice date names all three files of ${poNumber}.`
          }
          fileLine={`${dating.name} · ${formatBytes(dating.size)}`}
          initial={invoiceDate ?? today}
          confirmLabel={doc ? "Replace file" : "Upload"}
          onClose={() => setDating(null)}
          onConfirm={(date) => send(dating, date)}
        />
      ) : null}
      {replacing && doc ? (
        <ConfirmDialog
          title={`Replace the ${DOC_LABEL[kind].toLowerCase()}?`}
          description={`${doc.fileName} will be deleted from ${poNumber} and can’t be recovered.`}
          confirmLabel="Replace file"
          pendingLabel="Uploading…"
          onClose={() => setReplacing(null)}
          onConfirm={() => send(replacing)}
        >
          <p className="m-0 text-ink2">
            New file: <span className="id">{replacing.name}</span> · {formatBytes(replacing.size)}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
