"use client";

import { useId, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldMsg, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { hasErrors, validateStockRows, without, type FieldErrors } from "@/lib/form-validation";
import { addStockItems } from "@/app/(app)/stock/actions";

type Row = {
  key: string;
  tag: string;
  model: string;
  serialNumber: string;
  specifications: string;
  notes: string;
};

const blank = (from?: Row): Row => ({
  key: crypto.randomUUID(),
  tag: "",
  // Model and specifications carry down so a batch of the same item is quick to enter.
  model: from?.model ?? "",
  serialNumber: "",
  specifications: from?.specifications ?? "",
  notes: "",
});

/** Add items to the stock list by hand. Opens on `?new=1` (top-bar New, or N). */
export function AddStock({ open }: { open: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const ids = useId();
  const [rows, setRows] = useState<Row[]>(() => [blank()]);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("new");
    router.replace(`/stock${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  if (!open) return null;

  const set = (key: string, patch: Partial<Row>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((all) => {
      let next = all;
      if ("tag" in patch) next = without(next, `${key}:tag`);
      if ("model" in patch) next = without(next, `${key}:model`);
      return next;
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validateStockRows(rows);
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(form);
    setError(null);
    startTransition(async () => {
      const result = await addStockItems({
        items: rows.map(({ tag, model, serialNumber, specifications, notes }) => ({
          tag,
          model,
          serialNumber,
          specifications,
          notes,
        })),
      });
      if (!result.ok) {
        // "Tag X, Y is already in stock." belongs on those rows' tag fields.
        const clashes = /already in stock/i.test(result.error)
          ? rows.filter((r) => result.error.toLowerCase().includes(r.tag.trim().toLowerCase()))
          : [];
        if (clashes.length) {
          setErrors(Object.fromEntries(clashes.map((r) => [`${r.key}:tag`, "Already in stock."])));
          focusFirstInvalid(form);
        } else setError(result.error);
        return;
      }
      const { tags } = result.data;
      close();
      toast.show({
        text:
          tags.length === 1
            ? `Added ${tags[0]} to stock`
            : `Added ${tags[0]} … ${tags.at(-1)} (${tags.length} items) to stock`,
      });
    });
  };

  return (
    <FormDialog
      open
      wider
      onOpenChange={(o) => (o ? null : close())}
      title="Add to stock"
      description="One block per item. Model and specifications are copied to each new row."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Adding…" : rows.length > 1 ? `Add ${rows.length} items` : "Add item"}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const n = i + 1;
          const tagId = `${ids}-${r.key}-tag`;
          const modelId = `${ids}-${r.key}-model`;
          const serialId = `${ids}-${r.key}-serial`;
          const specsId = `${ids}-${r.key}-specs`;
          const notesId = `${ids}-${r.key}-notes`;
          return (
            <section
              key={r.key}
              aria-label={`Item ${n}`}
              className="flex flex-col gap-3 rounded-[var(--r-md)] border border-[var(--line2)] bg-[var(--sunk)] p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="lbl m-0">Item {n}</h3>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove row ${n}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                >
                  <Trash2Icon size={13} aria-hidden />
                </Button>
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-[minmax(150px,1fr)_minmax(0,2fr)_minmax(150px,1fr)]">
                <div className="fieldset">
                  <label htmlFor={tagId} className="lbl">
                    Tag
                  </label>
                  <input
                    id={tagId}
                    className="field font-mono text-[12px]"
                    aria-label={`Row ${n} tag`}
                    value={r.tag}
                    onChange={(e) => set(r.key, { tag: e.target.value })}
                    {...fieldProps(tagId, errors[`${r.key}:tag`])}
                    autoFocus={i === rows.length - 1}
                  />
                  <FieldMsg id={tagId} error={errors[`${r.key}:tag`]} />
                </div>
                <div className="fieldset">
                  <label htmlFor={modelId} className="lbl">
                    Model
                  </label>
                  <input
                    id={modelId}
                    className="field"
                    aria-label={`Row ${n} model`}
                    value={r.model}
                    onChange={(e) => set(r.key, { model: e.target.value })}
                    {...fieldProps(modelId, errors[`${r.key}:model`])}
                  />
                  <FieldMsg id={modelId} error={errors[`${r.key}:model`]} />
                </div>
                <div className="fieldset">
                  <label htmlFor={serialId} className="lbl">
                    Serial number
                  </label>
                  <input
                    id={serialId}
                    className="field font-mono text-[12px]"
                    aria-label={`Row ${n} serial number`}
                    value={r.serialNumber}
                    onChange={(e) => set(r.key, { serialNumber: e.target.value })}
                  />
                </div>
              </div>
              <div className="fieldset">
                <label htmlFor={specsId} className="lbl">
                  Specifications
                </label>
                <textarea
                  id={specsId}
                  className="field [field-sizing:content]"
                  rows={2}
                  placeholder="e.g. 16 GB / 512 GB, M3"
                  aria-label={`Row ${n} specifications`}
                  value={r.specifications}
                  onChange={(e) => set(r.key, { specifications: e.target.value })}
                />
              </div>
              <div className="fieldset">
                <label htmlFor={notesId} className="lbl">
                  Notes
                </label>
                <textarea
                  id={notesId}
                  className="field [field-sizing:content]"
                  rows={2}
                  placeholder="Anything worth knowing"
                  aria-label={`Row ${n} notes`}
                  value={r.notes}
                  onChange={(e) => set(r.key, { notes: e.target.value })}
                />
              </div>
            </section>
          );
        })}
        <div>
          <Button size="sm" onClick={() => setRows((all) => [...all, blank(all.at(-1))])}>
            <PlusIcon size={12} aria-hidden /> Add another item
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}
