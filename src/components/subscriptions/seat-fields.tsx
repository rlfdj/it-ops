"use client";

import { FieldMsg, Field, fieldProps } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import type { FieldErrors } from "@/lib/form-validation";
import { SEAT_TIER_LABEL, type SeatTier } from "@/lib/subscription-seats";

/** Standard / Premium seat counts for a renewal invoice of a tiered subscription. */
export function SeatCountFields({
  ids,
  standard,
  premium,
  onChange,
  errors,
  note,
}: {
  ids: string;
  standard: string;
  premium: string;
  onChange: (next: { standard: string; premium: string }) => void;
  errors: FieldErrors;
  /** A non-blocking note, e.g. when the counts differ from the seat roster. */
  note?: string | null;
}) {
  const total = (Number(standard) || 0) + (Number(premium) || 0);
  return (
    <>
      <Field
        label="Standard seats"
        htmlFor={`${ids}-seats-standard`}
        hint="Pre-filled from the seat roster, else the last invoice and any seats added since."
        error={errors.seatsStandard}
      >
        <input
          id={`${ids}-seats-standard`}
          className="field text-right"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={standard}
          onChange={(e) => onChange({ standard: e.target.value, premium })}
          {...fieldProps(`${ids}-seats-standard`, errors.seatsStandard)}
        />
      </Field>
      <Field
        label="Premium seats"
        htmlFor={`${ids}-seats-premium`}
        hint={`${total} ${total === 1 ? "seat" : "seats"} in total.`}
        error={errors.seatsPremium}
      >
        <input
          id={`${ids}-seats-premium`}
          className="field text-right"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={premium}
          onChange={(e) => onChange({ standard, premium: e.target.value })}
          {...fieldProps(`${ids}-seats-premium`, errors.seatsPremium)}
        />
      </Field>
      {note ? (
        <p className="alert sm m-0 sm:col-span-2" role="status" data-testid="roster-mismatch">
          {note}
        </p>
      ) : null}
    </>
  );
}

export type SeatLine = { key: string; personName: string; tier: SeatTier; project: string };

let lineCounter = 0;
export const newSeatLine = (): SeatLine => ({
  key: `seat-${++lineCounter}`,
  personName: "",
  tier: "standard",
  project: "",
});

/**
 * The seats a pro-rated invoice added: one line per seat with the person (suggestions from
 * On/Offboarding), the seat tier and an optional project. At least one line stays.
 */
export function SeatListFields({
  ids,
  seats,
  onChange,
  people,
  errors,
  clearError,
}: {
  ids: string;
  seats: SeatLine[];
  onChange: (next: SeatLine[]) => void;
  people: string[];
  errors: FieldErrors;
  clearError: (key: string) => void;
}) {
  const update = (key: string, patch: Partial<SeatLine>) =>
    onChange(seats.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 sm:col-span-2">
      <legend className="eyebrow mb-1 p-0">Seats added</legend>
      <datalist id={`${ids}-people`}>
        {people.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Seats">
        {seats.map((seat, index) => {
          const error = errors[`seat:${seat.key}:person`];
          const n = index + 1;
          return (
            <li
              key={seat.key}
              className="grid grid-cols-[minmax(0,1fr)_110px_32px] items-start gap-2 sm:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_32px]"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <input
                  id={`${ids}-seat-${seat.key}-person`}
                  className="field"
                  list={`${ids}-people`}
                  placeholder="Person"
                  aria-label={`Seat ${n} person`}
                  value={seat.personName}
                  onChange={(e) => {
                    update(seat.key, { personName: e.target.value });
                    clearError(`seat:${seat.key}:person`);
                  }}
                  {...fieldProps(`${ids}-seat-${seat.key}-person`, error)}
                />
                <FieldMsg id={`${ids}-seat-${seat.key}-person`} error={error} />
              </div>
              <select
                className="field"
                aria-label={`Seat ${n} tier`}
                value={seat.tier}
                onChange={(e) => update(seat.key, { tier: e.target.value as SeatTier })}
              >
                {(Object.keys(SEAT_TIER_LABEL) as SeatTier[]).map((tier) => (
                  <option key={tier} value={tier}>
                    {SEAT_TIER_LABEL[tier]}
                  </option>
                ))}
              </select>
              <input
                className="field max-sm:col-span-2 max-sm:row-start-2 sm:col-auto"
                placeholder="Project (optional)"
                aria-label={`Seat ${n} project`}
                value={seat.project}
                onChange={(e) => update(seat.key, { project: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                type="button"
                aria-label={`Remove seat ${n}`}
                disabled={seats.length === 1}
                onClick={() => onChange(seats.filter((s) => s.key !== seat.key))}
              >
                <span aria-hidden>×</span>
              </Button>
            </li>
          );
        })}
      </ul>
      {errors.seats ? (
        <span className="field-msg" role="alert">
          {errors.seats}
        </span>
      ) : null}
      <div>
        <Button
          size="sm"
          type="button"
          onClick={() => {
            onChange([...seats, newSeatLine()]);
            clearError("seats");
          }}
        >
          + Add seat
        </Button>
      </div>
    </fieldset>
  );
}
