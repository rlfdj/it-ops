"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { parseStockCsv, STOCK_CSV_TEMPLATE, type StockCsvRow } from "@/lib/stock-import";
import { importStockRows, previewStockImport } from "@/app/(app)/stock/actions";

type Preview = {
  fileName: string;
  rows: StockCsvRow[];
  errors: { row: number; message: string }[];
};

const SHOWN = 8;

/** "Import CSV" beside Export: pick a file, see per-row problems, then import it all at once. */
export function ImportStock() {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setPreview(null);
    setError(null);
  };

  const onFile = async (file: File | undefined) => {
    setPreview(null);
    setError(null);
    if (!file) return;
    const parsed = parseStockCsv(await file.text());
    if ("error" in parsed) return setError(parsed.error);
    startTransition(async () => {
      const result = await previewStockImport(parsed.rows);
      if (!result.ok) return setError(result.error);
      setPreview({ fileName: file.name, rows: parsed.rows, errors: result.data.errors });
    });
  };

  const commit = () => {
    if (!preview) return;
    startTransition(async () => {
      const result = await importStockRows(preview.rows);
      if (!result.ok) return setError(result.error);
      const { count } = result.data;
      close();
      router.refresh();
      toast.show({ text: `Imported ${count} item${count === 1 ? "" : "s"} to stock` });
    });
  };

  const bad = new Map(preview?.errors.map((e) => [e.row, e.message]));
  const blocked = Boolean(preview && (preview.errors.length > 0 || preview.rows.length === 0));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UploadIcon size={13} aria-hidden /> Import CSV
      </Button>
      {open ? (
        <FormDialog
          open
          wide
          onOpenChange={(o) => (o || pending ? null : close())}
          title="Import stock from CSV"
          description="Needs Tag and Model columns; Serial number, Specifications and Notes are optional. The Stock export imports as it is."
          footer={
            <>
              {error ? (
                <p className="alert red sm mr-auto self-center" role="alert">
                  {error}
                </p>
              ) : null}
              <Button variant="ghost" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" onClick={commit} disabled={pending || !preview || blocked}>
                {pending
                  ? "Working…"
                  : preview && !blocked
                    ? `Import ${preview.rows.length} item${preview.rows.length === 1 ? "" : "s"}`
                    : "Import"}
              </Button>
            </>
          }
        >
          <div className="fieldset">
            <label htmlFor={`${ids}-file`} className="lbl">
              CSV file
            </label>
            <input
              id={`${ids}-file`}
              type="file"
              accept=".csv,text/csv"
              className="field"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <a
              className="cap underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(STOCK_CSV_TEMPLATE)}`}
              download="stock-import-template.csv"
            >
              Download a template
            </a>
          </div>

          {preview ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="m-0 text-[13px]">
                <b>{preview.fileName}</b>: {preview.rows.length} row
                {preview.rows.length === 1 ? "" : "s"},{" "}
                {preview.errors.length
                  ? `${preview.errors.length} with problems. Fix the file and choose it again; nothing is imported until every row is valid.`
                  : "no problems found."}
              </p>
              {preview.errors.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Problems">
                  {preview.errors.slice(0, 50).map((e) => (
                    <li key={`${e.row}-${e.message}`} className="alert red sm">
                      {e.row ? `Row ${e.row}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                  {preview.errors.length > 50 ? (
                    <li className="cap">…and {preview.errors.length - 50} more.</li>
                  ) : null}
                </ul>
              ) : null}
              <div className="tw">
                <div role="table" aria-label="Import preview" style={{ minWidth: 480 }}>
                  <div
                    className="tr th flush"
                    role="row"
                    style={{ "--cols": "44px 110px 1fr 120px" } as React.CSSProperties}
                  >
                    <span role="columnheader">Row</span>
                    <span role="columnheader">Tag</span>
                    <span role="columnheader">Model</span>
                    <span role="columnheader">Serial</span>
                  </div>
                  {preview.rows.slice(0, SHOWN).map((r, i) => (
                    <div
                      key={i}
                      className="tr flush"
                      role="row"
                      style={{ "--cols": "44px 110px 1fr 120px" } as React.CSSProperties}
                    >
                      <span role="cell" className="muted">
                        {i + 1}
                      </span>
                      <span role="cell" className={`id ${bad.has(i + 1) ? "text-red" : ""}`}>
                        {r.tag || "—"}
                      </span>
                      <span role="cell" className="truncate">
                        {r.model || "—"}
                      </span>
                      <span role="cell" className="id text-ink2">
                        {r.serialNumber}
                      </span>
                    </div>
                  ))}
                </div>
                {preview.rows.length > SHOWN ? (
                  <p className="cap m-0 pt-1">
                    Showing the first {SHOWN} of {preview.rows.length} rows.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </FormDialog>
      ) : null}
    </>
  );
}
