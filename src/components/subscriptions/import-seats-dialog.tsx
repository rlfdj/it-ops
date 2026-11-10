"use client";

import { choosePanelTab } from "./panel-tabs";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormDialog } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { parseSeatList, SEAT_CSV_TEMPLATE, skippedNote, type SeatCsvRow } from "@/lib/seat-import";
import { importSeatRows, previewSeatImport } from "@/app/(app)/subscriptions/actions";

type Preview = {
  source: string;
  rows: SeatCsvRow[];
  problems: { row: number; message: string }[];
  standard: number;
  premium: number;
  unassigned: number;
  inactive: number;
};

const SHOWN = 10;
const COLS = "44px minmax(140px,1.6fr) 90px minmax(80px,1fr)";

/**
 * "Import seats": paste a list or choose a CSV (Claude's admin export, or Name / Seat /
 * Project), see per-row problems, then add every seat at once.
 */
export function ImportSeats({
  subscriptionId,
  subscriptionName,
}: {
  subscriptionId: string;
  subscriptionName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setText("");
    setPreview(null);
    setError(null);
  };

  const check = (source: string, content: string) => {
    setPreview(null);
    setError(null);
    const parsed = parseSeatList(content);
    if ("error" in parsed) return setError(parsed.error);
    startTransition(async () => {
      const result = await previewSeatImport(subscriptionId, parsed.rows);
      if (!result.ok) return setError(result.error);
      setPreview({ source, rows: parsed.rows, ...result.data });
    });
  };

  const commit = () => {
    if (!preview) return;
    startTransition(async () => {
      const result = await importSeatRows(subscriptionId, preview.rows);
      if (!result.ok) return setError(result.error);
      const { count } = result.data;
      close();
      choosePanelTab("seats"); // show what was imported
      router.refresh();
      toast.show({ text: `Imported ${count} seat${count === 1 ? "" : "s"}` });
    });
  };

  // Row numbers are the file's; skipped rows (Unassigned, not Active) are left out of the table.
  const shown = (preview?.rows ?? [])
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(
      ({ r }) =>
        r.seat.trim().toLowerCase() !== "unassigned" &&
        (!r.status?.trim() || r.status.trim().toLowerCase() === "active"),
    );
  const badRows = new Set(preview?.problems.map((p) => p.row));
  const valid = preview ? preview.standard + preview.premium : 0;
  const blocked = Boolean(preview && (preview.problems.length > 0 || valid === 0));
  const skipped = preview ? skippedNote(preview.unassigned, preview.inactive) : null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Import seats
      </Button>
      {open ? (
        <FormDialog
          open
          wide
          onOpenChange={(o) => (o || pending ? null : close())}
          title={`Import seats for ${subscriptionName}`}
          description="Paste a list or choose a CSV. Claude’s admin export imports as it is (the email identifies the person; Unassigned members are skipped). Otherwise use Email or Name, Seat (Standard or Premium) and an optional Project."
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
                    ? `Import ${valid} seat${valid === 1 ? "" : "s"}`
                    : "Import"}
              </Button>
            </>
          }
        >
          <div className="fieldset">
            <label htmlFor={`${ids}-text`} className="lbl">
              Paste a list
            </label>
            <textarea
              id={`${ids}-text`}
              className="field min-h-[96px] font-mono text-[12px]"
              placeholder={"email, seat\nsara@example.com, Premium"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div>
              <Button
                size="sm"
                disabled={pending || !text.trim()}
                onClick={() => check("Pasted list", text)}
              >
                Check pasted list
              </Button>
            </div>
          </div>
          <div className="fieldset">
            <label htmlFor={`${ids}-file`} className="lbl">
              Or a CSV file
            </label>
            <input
              id={`${ids}-file`}
              type="file"
              accept=".csv,text/csv"
              className="field"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) check(file.name, await file.text());
              }}
            />
            <a
              className="cap underline"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(SEAT_CSV_TEMPLATE)}`}
              download="seat-import-template.csv"
            >
              Download a template
            </a>
          </div>

          {preview ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <p className="m-0 text-[13px]" data-testid="seat-import-summary">
                <b>{preview.source}</b>: {preview.rows.length} row
                {preview.rows.length === 1 ? "" : "s"}
                {skipped ? ` (${skipped})` : ""}.{" "}
                {preview.problems.length
                  ? `${preview.problems.length} with problems. Fix the list and check it again; nothing is imported until every row is valid.`
                  : `${valid} seat${valid === 1 ? "" : "s"} to add: ${preview.standard} Standard · ${preview.premium} Premium.`}
              </p>
              {preview.problems.length ? (
                <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Problems">
                  {preview.problems.slice(0, 50).map((p) => (
                    <li key={`${p.row}-${p.message}`} className="alert red sm">
                      {p.row ? `Row ${p.row}: ` : ""}
                      {p.message}
                    </li>
                  ))}
                  {preview.problems.length > 50 ? (
                    <li className="cap">…and {preview.problems.length - 50} more.</li>
                  ) : null}
                </ul>
              ) : null}
              <div className="tw">
                <div role="table" aria-label="Import preview" style={{ minWidth: 460 }}>
                  <div
                    className="tr th flush"
                    role="row"
                    style={{ "--cols": COLS } as React.CSSProperties}
                  >
                    <span role="columnheader">Row</span>
                    <span role="columnheader">Person</span>
                    <span role="columnheader">Seat</span>
                    <span role="columnheader">Project</span>
                  </div>
                  {shown.slice(0, SHOWN).map(({ r, n }) => (
                    <div
                      key={n}
                      className="tr flush"
                      role="row"
                      style={{ "--cols": COLS } as React.CSSProperties}
                    >
                      <span role="cell" className="muted">
                        {n}
                      </span>
                      <span role="cell" className={`truncate ${badRows.has(n) ? "text-red" : ""}`}>
                        {r.name || "—"}
                      </span>
                      <span role="cell">{r.seat || "—"}</span>
                      <span role="cell" className="truncate text-ink2">
                        {r.project || "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {shown.length > SHOWN ? (
                  <p className="cap m-0 pt-1">
                    Showing the first {SHOWN} of {shown.length} rows.
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
