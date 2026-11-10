"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTip } from "@/components/icon-action";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Field, FormDialog, fieldProps } from "@/components/form-dialog";
import { useToast } from "@/components/shell/toast";
import {
  addSeatAction,
  removeSeatAction,
  updateSeatAction,
} from "@/app/(app)/subscriptions/actions";
import { filterSeats, rosterCounts, type RosterSeat } from "@/lib/seat-roster";
import { SEAT_TIER_LABEL, seatCountsLabel, type SeatTier } from "@/lib/subscription-seats";
import { ImportSeats } from "./import-seats-dialog";
import { choosePanelTab } from "./panel-tabs";

const COLS = "minmax(150px,2.2fr) 66px minmax(40px,1fr) 64px";

/**
 * The seat roster of a subscription: counts, a filter, the active seats (edit and remove),
 * an import and an export. Only seats held now are shown (ended seats are kept for the
 * invoice history, not listed). Long lists scroll inside the section.
 */
export function SeatsSection({
  subscriptionId,
  subscriptionName,
  seats,
  people,
  today,
}: {
  subscriptionId: string;
  subscriptionName: string;
  seats: RosterSeat[];
  /** Names of everyone in On/Offboarding, offered as suggestions. */
  people: string[];
  today: string;
}) {
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RosterSeat | null>(null);
  const [removing, setRemoving] = useState<RosterSeat | null>(null);
  const router = useRouter();
  const toast = useToast();

  const counts = rosterCounts(seats);
  const active = useMemo(() => seats.filter((s) => s.until === null), [seats]);
  const shownActive = filterSeats(active, filter);

  return (
    <section className="panel-section" aria-label="Seats">
      <div className="ps-head">
        <span className="eyebrow">Seats</span>
        <span className="muted text-[12px]" data-testid="seat-counts">
          {active.length ? seatCountsLabel(counts.standard, counts.premium) : "No seats yet"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <ImportSeats subscriptionId={subscriptionId} subscriptionName={subscriptionName} />
          {active.length ? (
            <a
              className="btn sm"
              href={`/subscriptions/seats/export?sub=${subscriptionId}`}
              download
              title="Everyone holding a seat now"
            >
              Export CSV
            </a>
          ) : null}
          <Button size="sm" onClick={() => setAdding(true)}>
            Add seat
          </Button>
        </span>
      </div>

      {active.length === 0 ? (
        <p className="m-0 py-4 text-ink3">
          Nobody holds a seat yet. Import a list, or add seats one by one.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 pb-2">
            <input
              className="field max-w-[260px]"
              type="search"
              placeholder="Filter by name or project"
              aria-label="Filter seats by name or project"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <span className="cap ml-auto">
              {filter.trim()
                ? `${shownActive.length} of ${active.length} active`
                : `${active.length} active`}
            </span>
          </div>
          <div className="max-h-[340px] overflow-y-auto" tabIndex={0} aria-label="Seat list">
            <div role="table" aria-label="Seat roster">
              <div
                className="tr th flush"
                role="row"
                style={{ "--cols": COLS } as React.CSSProperties}
              >
                <span role="columnheader">Person</span>
                <span role="columnheader">Seat</span>
                <span role="columnheader">Project</span>
                <span role="columnheader" className="sr-only">
                  Actions
                </span>
              </div>
              {shownActive.length === 0 ? (
                <p className="cap m-0 py-3">No active seat matches “{filter.trim()}”.</p>
              ) : null}
              {shownActive.map((s) => (
                <div
                  key={s.id}
                  className="tr flush"
                  role="row"
                  style={{ "--cols": COLS } as React.CSSProperties}
                >
                  <span role="cell" className="truncate" title={s.personName}>
                    {s.personName}
                  </span>
                  <span role="cell">{SEAT_TIER_LABEL[s.tier]}</span>
                  <span role="cell" className="truncate text-ink2" title={s.project ?? undefined}>
                    {s.project ?? "—"}
                  </span>
                  <span role="cell" className="acts flex justify-end gap-1">
                    <IconTip label="Edit">
                      <button
                        type="button"
                        className="btn ghost sm icon"
                        aria-label={`Edit seat: ${s.personName}`}
                        onClick={() => setEditing(s)}
                      >
                        <PencilIcon size={14} aria-hidden />
                      </button>
                    </IconTip>
                    <IconTip label="Remove">
                      <button
                        type="button"
                        className="btn ghost sm icon danger"
                        aria-label={`Remove seat: ${s.personName}`}
                        onClick={() => setRemoving(s)}
                      >
                        <Trash2Icon size={14} aria-hidden />
                      </button>
                    </IconTip>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {adding ? (
        <SeatFormDialog
          mode="add"
          subscriptionId={subscriptionId}
          subscriptionName={subscriptionName}
          people={people}
          today={today}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <SeatFormDialog
          mode="edit"
          seat={editing}
          subscriptionId={subscriptionId}
          subscriptionName={subscriptionName}
          people={people}
          today={today}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Remove ${removing.personName}’s seat?`}
          description={`The ${SEAT_TIER_LABEL[removing.tier]} seat ends today.`}
          confirmLabel="Remove seat"
          pendingLabel="Removing…"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const result = await removeSeatAction(removing.id);
            if (!result.ok) return result.error;
            router.refresh();
            toast.show({ text: `Removed ${removing.personName}’s seat` });
          }}
        />
      ) : null}
    </section>
  );
}

function SeatFormDialog({
  mode,
  seat,
  subscriptionId,
  subscriptionName,
  people,
  today,
  onClose,
}: {
  mode: "add" | "edit";
  seat?: RosterSeat;
  subscriptionId: string;
  subscriptionName: string;
  people: string[];
  today: string;
  onClose: () => void;
}) {
  const ids = useId();
  const router = useRouter();
  const toast = useToast();
  const [person, setPerson] = useState(seat?.personName ?? "");
  const [tier, setTier] = useState<SeatTier>(seat?.tier ?? "standard");
  const [project, setProject] = useState(seat?.project ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const personError = error && !person.trim() ? "Enter the person." : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!person.trim()) return setError("Enter the person.");
    setError(null);
    startTransition(async () => {
      const result =
        mode === "add"
          ? await addSeatAction({
              subscriptionId,
              personName: person,
              tier,
              project,
              since: today,
            })
          : await updateSeatAction({ id: seat!.id, tier, project });
      if (!result.ok) return setError(result.error);
      onClose();
      if (mode === "add") choosePanelTab("seats"); // show the new seat
      router.refresh();
      toast.show({
        text: mode === "add" ? `Added a seat for ${person.trim()}` : `Updated ${person}’s seat`,
      });
    });
  };

  return (
    <FormDialog
      open
      onOpenChange={(o) => (o || pending ? null : onClose())}
      title={mode === "add" ? "Add seat" : `Edit ${seat!.personName}’s seat`}
      description={subscriptionName}
      footer={
        <>
          {error ? (
            <p className="alert red sm mr-auto self-center" role="alert">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${ids}-form`} disabled={pending}>
            {pending ? "Saving…" : mode === "add" ? "Add seat" : "Save"}
          </Button>
        </>
      }
    >
      <form id={`${ids}-form`} noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <datalist id={`${ids}-people`}>
          {people.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <div className="sm:col-span-2">
          <Field
            label="Person"
            htmlFor={`${ids}-person`}
            hint={
              mode === "add"
                ? "A name or email. Names from On/Offboarding are suggested and linked."
                : undefined
            }
            error={personError}
          >
            <input
              id={`${ids}-person`}
              className="field"
              list={`${ids}-people`}
              value={person}
              disabled={mode === "edit"}
              autoFocus={mode === "add"}
              onChange={(e) => setPerson(e.target.value)}
              {...fieldProps(`${ids}-person`, personError)}
            />
          </Field>
        </div>
        <Field label="Seat" htmlFor={`${ids}-tier`}>
          <select
            id={`${ids}-tier`}
            className="field"
            value={tier}
            autoFocus={mode === "edit"}
            onChange={(e) => setTier(e.target.value as SeatTier)}
          >
            {(Object.keys(SEAT_TIER_LABEL) as SeatTier[]).map((t) => (
              <option key={t} value={t}>
                {SEAT_TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project" htmlFor={`${ids}-project`} hint="Optional.">
          <input
            id={`${ids}-project`}
            className="field"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
        </Field>
      </form>
    </FormDialog>
  );
}
