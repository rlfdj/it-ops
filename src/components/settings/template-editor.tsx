"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/shell/toast";
import { EQUIPMENT_ITEM, KIND_LABEL, type ChecklistKind } from "@/lib/checklists";
import {
  MAX_STEP_LABEL,
  MAX_TEMPLATE_STEPS,
  validateSteps,
  type TemplateStep,
} from "@/lib/checklist-templates";
import { saveTemplate } from "@/app/(app)/settings/actions";

type Row = { key: string; label: string; detail?: string };

const toRows = (steps: TemplateStep[]): Row[] =>
  steps.map((s) => ({ key: crypto.randomUUID(), ...s }));

/** The editable steps of one checklist template: add, remove, reorder, save. */
export function TemplateEditor({
  kind,
  initial,
}: {
  kind: ChecklistKind;
  initial: TemplateStep[];
}) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [saved, setSaved] = useState(initial);
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const list = useRef<HTMLUListElement>(null);

  const steps = rows.map(({ label, detail }) => ({ label, ...(detail ? { detail } : {}) }));
  const dirty =
    JSON.stringify(steps.map((s) => ({ ...s, label: s.label.trim() }))) !== JSON.stringify(saved);

  const focusRow = (key: string, then?: () => void) =>
    requestAnimationFrame(() => {
      document.getElementById(`${ids}-${key}`)?.focus();
      then?.();
    });
  const update = (key: string, label: string) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, label } : r)));
  const move = (index: number, by: -1 | 1) => {
    const key = rows[index]!.key;
    setRows((all) => {
      const next = [...all];
      const target = index + by;
      if (target < 0 || target >= next.length) return all;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    focusRow(key);
  };
  const remove = (index: number) => {
    const neighbour = rows[index + 1] ?? rows[index - 1];
    setRows((all) => all.filter((_, i) => i !== index));
    if (neighbour) focusRow(neighbour.key);
  };
  const add = () => {
    const key = crypto.randomUUID();
    setRows((all) => [...all, { key, label: "" }]);
    focusRow(key);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateSteps(steps);
    if (problem) return setError(problem);
    setError(null);
    startTransition(async () => {
      const result = await saveTemplate(kind, steps);
      if (!result.ok) return setError(result.error);
      setSaved(steps.map((s) => ({ ...s, label: s.label.trim() })));
      router.refresh();
      toast.show({ text: `${KIND_LABEL[kind]} template saved` });
    });
  };

  return (
    <form
      className="fieldset flex flex-col gap-2"
      noValidate
      aria-labelledby={`${ids}-title`}
      onSubmit={submit}
    >
      <span className="lbl" id={`${ids}-title`}>
        {KIND_LABEL[kind]} template
      </span>
      <ul ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
        <li className="flex items-center gap-2">
          <input
            className="field"
            value={EQUIPMENT_ITEM[kind].label}
            disabled
            aria-label="Equipment step (built in)"
          />
          <span className="cap shrink-0">Built in</span>
        </li>
        {rows.map((row, i) => (
          <li key={row.key} className="flex items-center gap-1">
            <input
              id={`${ids}-${row.key}`}
              className="field"
              value={row.label}
              maxLength={MAX_STEP_LABEL}
              aria-label={`${KIND_LABEL[kind]} step ${i + 1}`}
              onChange={(e) => update(row.key, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={`Move step ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUpIcon size={14} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Move step ${i + 1} down`}
              disabled={i === rows.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDownIcon size={14} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => remove(i)}
            >
              <XIcon size={14} aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <span className="cap">
        The equipment step is always first; its pieces are entered per person. Up to{" "}
        {MAX_TEMPLATE_STEPS} more steps.
      </span>
      {error ? (
        <p className="alert red sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={rows.length >= MAX_TEMPLATE_STEPS} onClick={add}>
          <PlusIcon size={14} aria-hidden /> Add step
        </Button>
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          {pending ? "Saving…" : `Save ${kind} template`}
        </Button>
      </div>
    </form>
  );
}
