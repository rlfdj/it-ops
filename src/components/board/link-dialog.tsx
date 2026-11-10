"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormDialog } from "@/components/form-dialog";
import { loadNoteLinkOptions } from "@/app/(app)/board/actions";
import type { NoteLink, NoteLinkOption } from "@/lib/queries/board";

/** Link a note to a PO, subscription, person or task (the same picker as a task's Related). */
export function LinkDialog({
  current,
  onSave,
  onClose,
}: {
  current: NoteLink | null;
  onSave: (option: NoteLinkOption | null) => Promise<string | void>;
  onClose: () => void;
}) {
  const ids = useId();
  const [options, setOptions] = useState<NoteLinkOption[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    void loadNoteLinkOptions().then((r) => {
      if (!live) return;
      if (r.ok) setOptions(r.data.options);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, []);

  const submit = async (option: NoteLinkOption | null) => {
    setPending(true);
    const message = await onSave(option);
    setPending(false);
    if (typeof message === "string") setError(message);
    else onClose();
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : onClose())}
      title="Link a record"
      description="Shows on the note as a chip that opens the record."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          {current ? (
            <Button variant="ghost" disabled={pending} onClick={() => void submit(null)}>
              Remove link
            </Button>
          ) : null}
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={`${ids}-form`}
            disabled={pending || options === null}
          >
            {pending ? "Saving…" : "Save link"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const found = options?.find((o) => o.label.toLowerCase() === value.trim().toLowerCase());
          if (!found) return setError("Pick a record from the list.");
          setError(null);
          void submit(found);
        }}
      >
        <Field
          label="Record"
          htmlFor={`${ids}-record`}
          hint="Start typing a PO number, subscription, person or task."
        >
          <input
            id={`${ids}-record`}
            className="field"
            list={`${ids}-options`}
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={current?.label ?? ""}
          />
          <datalist id={`${ids}-options`}>
            {(options ?? []).map((o) => (
              <option key={`${o.kind}-${o.id}`} value={o.label} />
            ))}
          </datalist>
        </Field>
      </form>
    </FormDialog>
  );
}
