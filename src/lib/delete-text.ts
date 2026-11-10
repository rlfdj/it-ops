// The wording of every "Delete …" confirmation, built from live counts (kept pure so it is
// tested): "Delete ChatGPT Business? This also deletes 6 invoices and 6 attached files. …"

/** What deleting a record takes with it, and what it leaves behind. */
export type DeleteImpact = {
  /** Phrases for what is deleted with the record, e.g. "6 invoices". Empty phrases are skipped. */
  deletes: string[];
  /** Whole sentences about what stays (e.g. "2 linked tasks stay, unlinked."). */
  keeps: string[];
};

/** "1 invoice", "6 invoices". */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "a", "a and b", "a, b and c". */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function deleteTitle(name: string): string {
  return `Delete ${name}?`;
}

/** The body of the confirmation: what goes, what stays, and that it can't be undone. */
export function deleteDescription(impact: DeleteImpact): string {
  const parts: string[] = [];
  if (impact.deletes.length) parts.push(`This also deletes ${joinList(impact.deletes)}.`);
  parts.push(...impact.keeps);
  parts.push("This can’t be undone.");
  return parts.join(" ");
}
