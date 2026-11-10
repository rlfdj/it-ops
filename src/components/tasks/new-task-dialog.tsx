"use client";

import { DateField } from "@/components/date-field";
import { useId, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { hasErrors, validateTask, without, type FieldErrors } from "@/lib/form-validation";
import { STATUS_LABEL, type TaskStatus } from "@/lib/tasks";
import type { TaskLinkOption } from "@/lib/queries/tasks";
import { createNewTask, removeTask } from "@/app/(app)/tasks/actions";

/** New task dialog. Opens on `?new=1` (the top-bar New button, or N). */
export function NewTaskDialog({ open, options }: { open: boolean; options: TaskLinkOption[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const ids = useId();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("2");
  const [status, setStatus] = useState<TaskStatus>("open");
  const [notes, setNotes] = useState("");
  const [related, setRelated] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("new");
    router.replace(`/tasks${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  if (!open) return null;

  const find = (label: string) =>
    options.find((o) => o.label.toLowerCase() === label.trim().toLowerCase());

  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : close())}
      title="New task"
      description="Link it to a PO, subscription or person if it belongs to one."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Adding…" : "Add task"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="grid gap-4 sm:grid-cols-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const found = validateTask({ title, dueDate });
          const link = related.trim() ? find(related) : undefined;
          if (related.trim() && !link)
            found.related = "Pick a record from the list, or clear this.";
          setErrors(found);
          if (hasErrors(found)) return focusFirstInvalid(e.currentTarget);
          setError(null);
          startTransition(async () => {
            const result = await createNewTask({
              title,
              dueDate,
              priority: Number(priority),
              status,
              notes,
              related: link ? { kind: link.kind, id: link.id } : null,
            });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            const { id } = result.data;
            const added = title.trim();
            close();
            router.refresh();
            toast.show({
              text: `Task added: “${added}”`,
              undo: async () => {
                const removed = await removeTask(id);
                if (removed.ok) router.refresh();
                return removed;
              },
            });
          });
        }}
      >
        <div className="sm:col-span-3">
          <Field label="Title" htmlFor={`${ids}-title`} error={errors.title}>
            <input
              id={`${ids}-title`}
              className="field"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErrors((all) => without(all, "title"));
              }}
              placeholder="e.g. Chase the Dell invoice"
              {...fieldProps(`${ids}-title`, errors.title)}
              autoFocus
            />
          </Field>
        </div>
        <Field label="Due date" htmlFor={`${ids}-due`} error={errors.dueDate}>
          <DateField
            id={`${ids}-due`}
            className="field"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              setErrors((all) => without(all, "dueDate"));
            }}
            {...fieldProps(`${ids}-due`, errors.dueDate)}
          />
        </Field>
        <Field label="Priority" htmlFor={`${ids}-p`}>
          <select
            id={`${ids}-p`}
            className="field"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="1">P1 · High</option>
            <option value="2">P2 · Normal</option>
            <option value="3">P3 · Low</option>
          </select>
        </Field>
        <Field label="Status" htmlFor={`${ids}-s`}>
          <select
            id={`${ids}-s`}
            className="field"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-3">
          <Field
            label="Related record (optional)"
            htmlFor={`${ids}-related`}
            hint="Start typing a PO number, subscription or person."
            error={errors.related}
          >
            <input
              id={`${ids}-related`}
              className="field"
              list={`${ids}-options`}
              autoComplete="off"
              value={related}
              onChange={(e) => {
                setRelated(e.target.value);
                setErrors((all) => without(all, "related"));
              }}
              {...fieldProps(`${ids}-related`, errors.related)}
            />
            <datalist id={`${ids}-options`}>
              {options.map((o) => (
                <option key={`${o.kind}-${o.id}`} value={o.label} />
              ))}
            </datalist>
          </Field>
        </div>
        <div className="sm:col-span-3">
          <Field label="Notes (optional)" htmlFor={`${ids}-notes`}>
            <textarea
              id={`${ids}-notes`}
              className="field"
              rows={4}
              maxLength={5000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      </form>
    </FormDialog>
  );
}
