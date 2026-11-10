"use client";

import { DateField } from "@/components/date-field";
import { useId, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldMsg,
  FormDialog,
  fieldProps,
  focusFirstInvalid,
} from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import {
  hasErrors,
  validateChecklistItem,
  validateNewChecklist,
  without,
  type FieldErrors,
} from "@/lib/form-validation";
import { formatDate } from "@/lib/dates";
import { SECTION_LABEL, type ChecklistKind, type Section } from "@/lib/checklists";
import { buildTemplateItems, type TemplateStep } from "@/lib/checklist-templates";
import { DeleteRecordButton } from "@/components/delete-record";
import {
  addItem,
  checklistDeletePreview,
  removeChecklist,
  removeItem,
  startChecklist,
} from "@/app/(app)/onboarding/actions";

type PersonOption = { id: string; name: string; department: string | null; status: string };
type DraftItem = {
  key: string;
  section: Section;
  label: string;
  detail: string;
  /** Empty means "the checklist's date" (the last day when offboarding). */
  dueDate: string;
  equipment: boolean;
  pieces: string;
};

const draftFrom = (kind: ChecklistKind, steps: TemplateStep[]): DraftItem[] =>
  buildTemplateItems(kind, steps).map((t) => ({
    key: crypto.randomUUID(),
    section: t.section,
    label: t.label,
    detail: t.detail ?? "",
    dueDate: "",
    equipment: Boolean(t.equipment),
    pieces: "",
  }));

/** New on/offboarding checklist. Opens on `?new=1` (top-bar New, or N). */
export function NewChecklist({
  open,
  people,
  today,
  templates,
}: {
  open: boolean;
  people: PersonOption[];
  today: string;
  /** The saved template steps per kind (the equipment step is added on top). */
  templates: Record<ChecklistKind, TemplateStep[]>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const ids = useId();
  const [kind, setKind] = useState<ChecklistKind>("onboarding");
  const [personId, setPersonId] = useState<string>("new");
  const [fullName, setFullName] = useState("");
  const [department, setDepartment] = useState("");
  const [managerName, setManagerName] = useState("");
  const [targetDate, setTargetDate] = useState(today);
  const [items, setItems] = useState<DraftItem[]>(() =>
    draftFrom("onboarding", templates.onboarding),
  );
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  const close = (checklistId?: string) => {
    const next = new URLSearchParams(params);
    next.delete("new");
    if (checklistId) {
      next.delete("person");
      next.set("checklist", checklistId);
    }
    router.replace(`/onboarding${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  if (!open) return null;

  const set = (key: string, patch: Partial<DraftItem>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const eligible = people.filter((p) => p.status !== "left");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validateNewChecklist({
      targetDate,
      newPerson: personId === "new",
      fullName,
      items,
    });
    setErrors(found);
    if (hasErrors(found)) return focusFirstInvalid(form);
    setError(null);
    const person = personId === "new" ? { fullName, department, managerName } : { id: personId };
    startTransition(async () => {
      const result = await startChecklist({
        kind,
        targetDate,
        person,
        items: items.map((i) => ({
          section: i.section,
          label: i.label,
          detail: i.detail,
          dueDate: i.dueDate,
          children: i.equipment
            ? i.pieces
                .split(/\n|,/)
                .map((p) => p.trim())
                .filter(Boolean)
            : [],
        })),
      });
      if (!result.ok) setError(result.error);
      else {
        close(result.data.checklistId);
        const who =
          personId === "new" ? fullName.trim() : eligible.find((p) => p.id === personId)?.name;
        toast.show({
          text: `${kind === "onboarding" ? "Onboarding" : "Offboarding"} checklist created${who ? ` for ${who}` : ""}`,
        });
      }
    });
  };

  return (
    <FormDialog
      open
      wide
      onOpenChange={(o) => (o ? null : close())}
      title="New checklist"
      description="Each item becomes a task in Tasks. Equipment is ticked off piece by piece."
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={() => close()}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Creating…" : "Create checklist"}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type" htmlFor={`${ids}-kind`}>
            <select
              id={`${ids}-kind`}
              className="field"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as ChecklistKind;
                setKind(k);
                setItems(draftFrom(k, templates[k]));
                if (k === "offboarding" && personId === "new")
                  setPersonId(eligible[0]?.id ?? "new");
              }}
            >
              <option value="onboarding">Onboarding</option>
              <option value="offboarding">Offboarding</option>
            </select>
          </Field>
          <Field label="Person" htmlFor={`${ids}-person`}>
            <select
              id={`${ids}-person`}
              className="field"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="new">New person…</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.department ? ` · ${p.department}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={kind === "onboarding" ? "Start date" : "Last day"}
            htmlFor={`${ids}-date`}
            error={errors.date}
          >
            <DateField
              id={`${ids}-date`}
              className="field"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value);
                setErrors((all) => without(all, "date"));
              }}
              {...fieldProps(`${ids}-date`, errors.date)}
            />
          </Field>
        </div>

        {personId === "new" ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Full name" htmlFor={`${ids}-name`} error={errors.name}>
              <input
                id={`${ids}-name`}
                className="field"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrors((all) => without(all, "name"));
                }}
                {...fieldProps(`${ids}-name`, errors.name)}
                autoFocus
              />
            </Field>
            <Field label="Department" htmlFor={`${ids}-dept`}>
              <input
                id={`${ids}-dept`}
                className="field"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              />
            </Field>
            <Field label="Manager" htmlFor={`${ids}-mgr`}>
              <input
                id={`${ids}-mgr`}
                className="field"
                value={managerName}
                onChange={(e) => setManagerName(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <span className="lbl">Items</span>
          <span className="cap">
            Items without a due date use the {kind === "onboarding" ? "start date" : "last day"}
            {targetDate ? ` (${formatDate(targetDate)})` : ""}.
          </span>
          {items.map((i) => (
            <div key={i.key} className="flex flex-col gap-2 border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <span className="cap w-[84px] shrink-0">{SECTION_LABEL[i.section]}</span>
                <input
                  id={`${ids}-item-${i.key}`}
                  className="field min-w-0 flex-1"
                  aria-label="Item"
                  value={i.label}
                  onChange={(e) => {
                    set(i.key, { label: e.target.value });
                    setErrors((all) => without(all, `item:${i.key}`));
                  }}
                  {...fieldProps(`${ids}-item-${i.key}`, errors[`item:${i.key}`])}
                />
                <DateField
                  wrapperClassName="w-[150px] shrink-0 max-sm:w-[132px]"
                  className="w-full!"
                  // Empty means "the last day / start date": show that date, greyed, as the hint.
                  placeholder={targetDate ? formatDate(targetDate) : "Default date"}
                  aria-label={`Due date for ${i.label || "item"}`}
                  value={i.dueDate}
                  onChange={(e) => set(i.key, { dueDate: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${i.label || "item"}`}
                  disabled={items.length === 1}
                  onClick={() => setItems((all) => all.filter((x) => x.key !== i.key))}
                >
                  <Trash2Icon size={13} aria-hidden />
                </Button>
              </div>
              <FieldMsg id={`${ids}-item-${i.key}`} error={errors[`item:${i.key}`]} />
              {i.equipment ? (
                <textarea
                  className="field ml-[92px] min-h-[56px] w-auto! py-2"
                  aria-label={`Equipment for ${i.label}`}
                  placeholder={
                    kind === "offboarding"
                      ? "Equipment to collect, one per line — e.g. MacBook Air 13″ (DP-LT-0197), Dell monitor, access card"
                      : "Equipment to issue, one per line — e.g. MacBook Pro 14″, monitor and dock"
                  }
                  value={i.pieces}
                  onChange={(e) => set(i.key, { pieces: e.target.value })}
                />
              ) : null}
            </div>
          ))}
          <div>
            <Button
              size="sm"
              onClick={() =>
                setItems((all) => [
                  ...all,
                  {
                    key: crypto.randomUUID(),
                    section: "accounts",
                    label: "",
                    detail: "",
                    dueDate: "",
                    equipment: false,
                    pieces: "",
                  },
                ])
              }
            >
              <PlusIcon size={12} aria-hidden /> Add item
            </Button>
          </div>
        </div>
      </form>
    </FormDialog>
  );
}

/** "Add item" on a checklist. */
export function AddChecklistItem({
  checklistId,
  defaultDue,
}: {
  checklistId: string;
  defaultDue: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("accounts");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState(defaultDue);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add item</Button>
      {open ? (
        <FormDialog
          open
          onOpenChange={setOpen}
          title="Add item"
          description="It also appears in Tasks."
          footer={
            <>
              {error ? (
                <p className="alert red sm mr-auto self-center" role="alert">
                  {error}
                </p>
              ) : null}
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
                {pending ? "Adding…" : "Add item"}
              </Button>
            </>
          }
        >
          <form
            id={`${ids}-form`}
            className="grid gap-4 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const found = validateChecklistItem({ label, dueDate });
              setErrors(found);
              if (hasErrors(found)) return focusFirstInvalid(e.currentTarget);
              setError(null);
              startTransition(async () => {
                const result = await addItem({ checklistId, section, label, detail, dueDate });
                if (!result.ok) setError(result.error);
                else {
                  const added = label.trim();
                  const { id } = result.data;
                  setOpen(false);
                  setLabel("");
                  setDetail("");
                  setErrors({});
                  router.refresh();
                  toast.show({
                    text: `Added “${added}”`,
                    // Removing that one item again; a repeat finds it gone and says so.
                    undo: async () => {
                      const removed = await removeItem(id);
                      if (removed.ok) router.refresh();
                      return removed;
                    },
                  });
                }
              });
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Item" htmlFor={`${ids}-label`} error={errors.label}>
                <input
                  id={`${ids}-label`}
                  className="field"
                  value={label}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    setErrors((all) => without(all, "label"));
                  }}
                  placeholder="e.g. Remove from Slack"
                  {...fieldProps(`${ids}-label`, errors.label)}
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Section" htmlFor={`${ids}-section`}>
              <select
                id={`${ids}-section`}
                className="field"
                value={section}
                onChange={(e) => setSection(e.target.value as Section)}
              >
                <option value="accounts">Accounts</option>
                <option value="assets">Equipment</option>
              </select>
            </Field>
            <Field label="Due" htmlFor={`${ids}-due`} error={errors.dueDate}>
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
            <div className="sm:col-span-2">
              <Field label="Detail" htmlFor={`${ids}-detail`} hint="Optional.">
                <input
                  id={`${ids}-detail`}
                  className="field"
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                />
              </Field>
            </div>
          </form>
        </FormDialog>
      ) : null}
    </>
  );
}

/** Deletes the open checklist with its items and generated tasks (and the person, if nothing else refers to them). */
export function DeleteChecklist({ checklistId }: { checklistId: string }) {
  const router = useRouter();
  return (
    <DeleteRecordButton
      className=""
      label="Delete checklist"
      preview={() => checklistDeletePreview(checklistId)}
      remove={() => removeChecklist(checklistId)}
      onDeleted={() => {
        router.replace("/onboarding", { scroll: false });
        router.refresh();
      }}
    />
  );
}
