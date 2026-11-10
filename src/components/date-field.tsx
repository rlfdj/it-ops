"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Popover } from "radix-ui";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useToday } from "@/components/workspace-context";
import { formatDateInput, monthGrid, monthLabel, monthOf, parseDateInput } from "@/lib/date-input";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type Props = Omit<
  ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "pattern"
> & {
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string;
  /** Called with the same `{ target: { value } }` shape a native input gives (ISO or ""). */
  onChange?: (event: { target: { value: string } }) => void;
  /** Classes for the wrapper (input + calendar button), e.g. a fixed width in a flex row. */
  wrapperClassName?: string;
};

/**
 * A date input that shows and accepts "13 Oct 2026" (also ISO and day-first 13/10/2026)
 * and opens a calendar. It emits the same `YYYY-MM-DD` value a native date input does.
 */
export function DateField({
  value,
  onChange,
  className = "",
  wrapperClassName = "",
  placeholder = "DD Mon YYYY",
  name,
  onBlur,
  required,
  ...rest
}: Props) {
  const [text, setText] = useState(() => formatDateInput(value));
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Follow the value when it changes from outside (a form reset, a pre-fill).
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (parseDateInput(text) !== value) setText(formatDateInput(value));
  }

  const invalid = text.trim() !== "" && parseDateInput(text) === null;
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? "Enter a date like 13 Oct 2026." : "");
  }, [invalid]);

  const emit = (next: string) => onChange?.({ target: { value: next } });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <span className={`relative flex min-w-0 items-center ${wrapperClassName}`}>
          {name ? <input type="hidden" name={name} value={value} /> : null}
          <input
            {...rest}
            ref={input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder}
            required={required}
            className={`field pr-9! ${className}`}
            value={text}
            aria-invalid={rest["aria-invalid"] ?? (invalid ? true : undefined)}
            aria-describedby={rest["aria-describedby"]}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              if (next.trim() === "") emit("");
              else {
                const parsed = parseDateInput(next);
                if (parsed) emit(parsed);
              }
            }}
            onBlur={(e) => {
              const parsed = parseDateInput(text);
              if (parsed) setText(formatDateInput(parsed));
              onBlur?.(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && e.altKey) {
                e.preventDefault();
                setOpen(true);
              }
            }}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              className="absolute right-1.5 flex size-6 items-center justify-center rounded text-ink3 hover:text-ink"
              aria-label="Open calendar"
              aria-describedby={hintId}
            >
              <CalendarIcon size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </Popover.Trigger>
          <span id={hintId} hidden>
            Type a date such as 13 Oct 2026, or pick one.
          </span>
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[70] rounded-lg border border-line2 bg-surface-2 p-2 text-ink shadow-1"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            input.current?.focus();
          }}
        >
          <Calendar
            value={value}
            onPick={(date) => {
              setText(formatDateInput(date));
              emit(date);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Calendar({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const today = useToday();
  const start = monthOf(value, today);
  const [view, setView] = useState(start);
  const grid = monthGrid(view.year, view.month);
  const move = (by: number) =>
    setView(({ year, month }) => {
      const total = year * 12 + month + by;
      return { year: Math.floor(total / 12), month: total % 12 };
    });

  return (
    <div className="w-[236px]" role="group" aria-label="Calendar">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          className="btn sm icon"
          aria-label="Previous month"
          onClick={() => move(-1)}
        >
          <ChevronLeftIcon size={14} aria-hidden />
        </button>
        <span className="text-[13px] font-semibold" aria-live="polite">
          {monthLabel(view.year, view.month)}
        </span>
        <button
          type="button"
          className="btn sm icon"
          aria-label="Next month"
          onClick={() => move(1)}
        >
          <ChevronRightIcon size={14} aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-ink3">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">
        {grid.flat().map(({ date, inMonth }) => {
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              aria-label={formatDateInput(date)}
              aria-pressed={selected}
              onClick={() => onPick(date)}
              className={`h-8 rounded text-[12px] tabular-nums hover:bg-sunk ${
                selected
                  ? "bg-ink font-semibold text-surface-2 hover:bg-ink"
                  : inMonth
                    ? "text-ink"
                    : "text-ink3"
              } ${date === today && !selected ? "font-semibold underline" : ""}`}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between">
        <button type="button" className="link text-[12px]" onClick={() => onPick(today)}>
          Today
        </button>
        {value ? (
          <button type="button" className="link text-[12px]" onClick={() => onPick("")}>
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
