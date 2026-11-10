"use client";

import { DateField } from "@/components/date-field";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";

/** Record search (label text or a record id), kept in the URL. */
export function RecordFilter({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  // A new URL value (a link, Back) replaces what is typed.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setValue(initial);
  }

  useEffect(() => {
    // Compare the trimmed text: the URL keeps "abc" for "abc ", so comparing the raw value
    // would replace the URL again every 300 ms, forever (one server render each time).
    if (value.trim() === initial) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      next.delete("record");
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, initial, params, pathname, router]);

  return (
    <label className="field-wrap w-[260px] max-[760px]:w-full">
      <SearchIcon className="ico" size={14} strokeWidth={2} aria-hidden />
      <span className="sr-only">Filter by record</span>
      <input
        type="text"
        data-filter
        placeholder="PO, subscription, person or task"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        className="placeholder:text-ink3"
      />
      <span className="kbd">/</span>
    </label>
  );
}

/** Custom date range (from / to), kept in the URL. */
export function DateRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const apply = (key: "from" | "to", value: string) => {
    const next = new URLSearchParams(params);
    next.delete("range");
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  return (
    <span className="cap inline-flex flex-wrap items-center gap-1.5">
      <DateField
        aria-label="From"
        className="field w-[140px]!"
        value={from}
        onChange={(e) => apply("from", e.target.value)}
      />
      to
      <DateField
        aria-label="To"
        className="field w-[140px]!"
        value={to}
        onChange={(e) => apply("to", e.target.value)}
      />
    </span>
  );
}
