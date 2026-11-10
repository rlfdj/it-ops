"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DownloadIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDocumentPreview } from "@/app/(app)/documents/actions";
import { documentHref } from "@/lib/links";

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const PDF = /\.pdf$/i;

type Loaded = { url: string; fileName: string };

/**
 * Right-hand preview sheet for one stored document. The signed URL is fetched each time the
 * sheet opens (60 second expiry) and kept only in memory. `onReplace`, when given, adds a Replace button.
 */
export function DocumentPreviewSheet({
  documentId,
  fileName,
  open,
  onOpenChange,
  onReplace,
}: {
  documentId: string;
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace?: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getDocumentPreview(documentId).then((result) => {
      if (cancelled) return;
      if (result.ok) setLoaded(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
      setLoaded(null);
      setError(null);
    };
  }, [open, documentId]);

  const name = loaded?.fileName ?? fileName;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-0 right-0 left-auto h-(--vh100) max-h-none w-[min(760px,92vw)] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 rounded-none border-y-0 border-r-0 p-0 sm:max-w-none"
        aria-describedby="doc-preview-desc"
      >
        <DialogHeader className="gap-2 border-b border-line p-4 pr-14">
          <DialogTitle className="id truncate text-[13px]" title={name}>
            {name}
          </DialogTitle>
          <DialogDescription id="doc-preview-desc" className="sr-only">
            Preview of the attached document.
          </DialogDescription>
          <div className="flex flex-wrap gap-2">
            <a className="btn sm" href={`${documentHref(documentId)}?download`} download={fileName}>
              <DownloadIcon size={13} aria-hidden /> Download
            </a>
            <a className="btn sm" href={documentHref(documentId)} target="_blank" rel="noreferrer">
              <ExternalLinkIcon size={13} aria-hidden /> Open in new tab
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            {onReplace ? (
              <Button size="sm" onClick={onReplace}>
                Replace
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 bg-surface">
          {error ? (
            <p className="alert red sm m-4" role="alert">
              {error}
            </p>
          ) : !loaded ? (
            <p className="muted m-4" aria-live="polite">
              Loading preview…
            </p>
          ) : IMAGE.test(name) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={loaded.url}
              alt={name}
              className="mx-auto max-h-full max-w-full object-contain p-4"
            />
          ) : PDF.test(name) ? (
            <iframe
              src={loaded.url}
              title={`Preview of ${name}`}
              className="h-full w-full border-0"
            />
          ) : (
            <p className="muted m-4">
              This file type can’t be previewed. Use Download or Open in new tab.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Drop-in for a document link: on screens wider than a phone it opens the preview sheet;
 * on phones, or with a modified click (new tab, new window), it behaves as the plain link to
 * `/documents/{id}` in a new tab.
 */
export function DocumentPreviewLink({
  documentId,
  fileName,
  className,
  title,
  children,
  onReplace,
}: {
  documentId: string;
  fileName: string;
  className?: string;
  title?: string;
  children: ReactNode;
  onReplace?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={documentHref(documentId)}
        target="_blank"
        rel="noreferrer"
        className={className}
        title={title}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (!window.matchMedia("(min-width: 761px)").matches) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open ? (
        <DocumentPreviewSheet
          documentId={documentId}
          fileName={fileName}
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
