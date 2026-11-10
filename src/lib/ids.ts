// Pure helpers for human-readable identifiers. No imports, so scripts can use them too.
// (Stock tags are typed in by hand, so only PO numbers are generated.)

export const PO_NUMBER_PATTERN = /^PO-(\d{4})-(\d{4})$/;

const pad4 = (n: number) => {
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new RangeError(`Sequence number out of range: ${n}`);
  }
  return String(n).padStart(4, "0");
};

/** Counter scope for PO numbers, e.g. `PO-2026`. */
export const poNumberScope = (year: number) => `PO-${year}`;

/** e.g. `formatPoNumber(2026, 158)` → `PO-2026-0158`. */
export const formatPoNumber = (year: number, seq: number) => `${poNumberScope(year)}-${pad4(seq)}`;

/** Splits a PO number into its counter scope and sequence number. */
export function parsePoNumber(id: string): { scope: string; seq: number } | null {
  const po = PO_NUMBER_PATTERN.exec(id);
  return po ? { scope: `PO-${po[1]}`, seq: Number(po[2]) } : null;
}
