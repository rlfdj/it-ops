"use client";

import { DateField } from "@/components/date-field";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormDialog, fieldProps, focusFirstInvalid } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import { hasErrors, validateChecklistItem, without, type FieldErrors } from "@/lib/form-validation";
import { formatShortDate } from "@/lib/format";
import { todayIn } from "@/lib/dates";
import { useWorkspace } from "@/components/workspace-context";
import { formatDue } from "@/lib/tasks";
import { itemState } from "@/lib/checklists";
import type { ChecklistItemNode } from "@/lib/queries/checklists";
import {
  addItem,
  editItem,
  markNotApplicable,
  removeItem,
  tickItem,
  undoRemoveItem,
} from "@/app/(app)/onboarding/actions";

function Meta({ item, today, isSub }: { item: ChecklistItemNode; today: string; isSub: boolean }) {
  const { timeZone } = useWorkspace();
  const state = itemState(item, today);
  switch (state.kind) {
    case "na":
      return <span>Not applicable</span>;
    case "done":
      return <span>Done {formatShortDate(todayIn(timeZone, state.at), today)}</span>;
    case "overdue":
      return (
        <span className="st urgent c-red">
          Due {formatDue(state.due, today)}
          {isSub ? "" : " · in Tasks"}
        </span>
      );
    case "due":
      return (
        <span>
          Due {formatDue(state.due, today)}
          {isSub ? "" : " · in Tasks"}
        </span>
      );
    default:
      return <span>{isSub ? "" : "In Tasks"}</span>;
  }
}

function EditItemDialog({ item, onClose }: { item: ChecklistItemNode; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [label, setLabel] = useState(item.label);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  return (
    <FormDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Edit item"
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id={`${ids}-form`}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const found = validateChecklistItem({ label, dueDate });
          setErrors(found);
          if (hasErrors(found)) return focusFirstInvalid(e.currentTarget);
          setError(null);
          startTransition(async () => {
            const result = await editItem({ itemId: item.id, label, detail, dueDate });
            if (!result.ok) setError(result.error);
            else {
              onClose();
              router.refresh();
              toast.show({ text: `Saved “${label.trim()}”` });
            }
          });
        }}
      >
        <Field label="Item" htmlFor={`${ids}-label`} error={errors.label}>
          <input
            id={`${ids}-label`}
            className="field"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setErrors((all) => without(all, "label"));
            }}
            {...fieldProps(`${ids}-label`, errors.label)}
            autoFocus
          />
        </Field>
        <Field label="Detail" htmlFor={`${ids}-detail`}>
          <input
            id={`${ids}-detail`}
            className="field"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </Field>
        <Field
          label="Due"
          htmlFor={`${ids}-due`}
          error={errors.dueDate}
          hint="Leave empty to use the checklist date (the last day when offboarding)."
        >
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
      </form>
    </FormDialog>
  );
}

function Row({
  item,
  today,
  isSub,
  onError,
}: {
  item: ChecklistItemNode;
  today: string;
  isSub: boolean;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState(Boolean(item.doneAt));
  const [pending, startTransition] = useTransition();
  // Follow the server's done state after a refresh (e.g. a parent completing) instead of
  // re-keying the row, which would drop keyboard focus.
  const doneAtKey = item.doneAt?.getTime() ?? 0;
  const [seenDoneAt, setSeenDoneAt] = useState(doneAtKey);
  if (doneAtKey !== seenDoneAt) {
    setSeenDoneAt(doneAtKey);
    setDone(Boolean(item.doneAt));
  }
  const call = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    revert?: () => void,
    onOk?: () => void,
  ) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        revert?.();
        onError(result.error ?? "Something went wrong.");
      } else {
        onError(null);
        router.refresh();
        onOk?.();
      }
    });

  const shown = { ...item, doneAt: done ? (item.doneAt ?? new Date()) : null };
  return (
    <div
      className={`it ${isSub ? "sub" : ""} ${done ? "done" : ""} ${item.notApplicable ? "na" : ""}`}
    >
      <input
        type="checkbox"
        checked={done}
        // aria-busy, not disabled while saving: a disabled control loses focus (WCAG 2.4.3).
        disabled={item.notApplicable}
        aria-busy={pending}
        aria-label={`Done: ${item.label}`}
        onChange={(e) => {
          if (pending) return;
          const next = e.target.checked;
          setDone(next);
          call(
            () => tickItem(item.id, next),
            () => setDone(!next),
            () =>
              toast.show({
                text: next ? `Marked “${item.label}” done` : `Reopened “${item.label}”`,
                // Sets the opposite state explicitly, so a repeat does nothing more.
                undo: async () => {
                  const undone = await tickItem(item.id, !next);
                  if (undone.ok) {
                    setDone(!next);
                    router.refresh();
                  }
                  return undone;
                },
              }),
          );
        }}
      />
      <div className="flex min-w-0 flex-col gap-px">
        <span className={`lbl ${isSub ? "" : "fw-500"}`}>{item.label}</span>
        {item.detail ? <span className="cap">{item.detail}</span> : null}
      </div>
      <span className="meta">
        <Meta item={shown} today={today} isSub={isSub} />
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`More for ${item.label}`}>
            <MoreHorizontalIcon size={14} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              call(
                () => markNotApplicable(item.id, !item.notApplicable),
                undefined,
                () =>
                  toast.show({
                    text: item.notApplicable
                      ? `“${item.label}” applies again`
                      : `“${item.label}” marked not applicable`,
                    undo: async () => {
                      const undone = await markNotApplicable(item.id, item.notApplicable);
                      if (undone.ok) router.refresh();
                      return undone;
                    },
                  }),
              )
            }
          >
            {item.notApplicable ? "Make applicable" : "Not applicable"}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-red" onSelect={() => setRemoving(true)}>
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editing ? <EditItemDialog item={item} onClose={() => setEditing(false)} /> : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove “${item.label}”?`}
          description={
            item.children.length
              ? `Its ${item.children.length} piece${item.children.length === 1 ? "" : "s"} of equipment go with it, and so does its task. You can undo it for a few seconds afterwards.`
              : "Its task goes with it. You can undo it for a few seconds afterwards."
          }
          confirmLabel="Remove item"
          pendingLabel="Removing…"
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const result = await removeItem(item.id);
            if (!result.ok) return result.error;
            onError(null);
            router.refresh();
            toast.show({
              text: `Removed “${item.label}”`,
              undo: async () => {
                const restored = await undoRemoveItem(result.data);
                if (restored.ok) router.refresh();
                return restored;
              },
            });
          }}
        />
      ) : null}
    </div>
  );
}

/** A checklist item; equipment items show each piece underneath with "+ Add equipment". */
export function ChecklistItem({
  item,
  checklistId,
  today,
  equipment,
}: {
  item: ChecklistItemNode;
  checklistId: string;
  today: string;
  /** Show the add-a-piece input (the Equipment section). */
  equipment: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [piece, setPiece] = useState("");
  const [pending, startTransition] = useTransition();

  const addPiece = () => {
    if (!piece.trim()) return;
    if (pending) return;
    const label = piece.trim();
    startTransition(async () => {
      const result = await addItem({
        checklistId,
        section: item.section,
        label,
        parentId: item.id,
      });
      if (!result.ok) setError(result.error);
      else {
        setPiece("");
        setError(null);
        router.refresh();
        const { id } = result.data;
        toast.show({
          text: `Added “${label}” under ${item.label}`,
          // Removing that one piece again; a repeat finds it gone and says so.
          undo: async () => {
            const removed = await removeItem(id);
            if (removed.ok) router.refresh();
            return removed;
          },
        });
      }
    });
  };

  return (
    <div className="flex flex-col">
      {/* Rows follow the server's done state themselves, so a roll-up (a parent completing) shows without remounting (and losing focus). */}
      <Row key={item.id} item={item} today={today} isSub={false} onError={setError} />
      {item.children.map((child) => (
        <Row key={child.id} item={child} today={today} isSub onError={setError} />
      ))}
      {equipment && !item.notApplicable ? (
        <div className="flex items-center gap-1.5 border-b border-line py-1 pl-8">
          <PlusIcon size={13} className="text-ink3" aria-hidden />
          <input
            className="field ghost min-w-0 flex-1 truncate"
            placeholder="Add equipment, e.g. MacBook Pro 14″, charger, access card"
            aria-label={`Add equipment under ${item.label}`}
            value={piece}
            readOnly={pending}
            aria-busy={pending}
            onChange={(e) => setPiece(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPiece();
              }
            }}
          />
          {piece.trim() ? (
            <Button size="sm" onClick={addPiece} disabled={pending}>
              Add
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="alert red sm my-1.5" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
