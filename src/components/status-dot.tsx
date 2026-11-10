export type Tone = "red" | "amber" | "green" | "blue" | "grey";

/** Status as a 6px dot plus text — never a coloured pill. */
export function StatusDot({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`st c-${tone}`}>{children}</span>;
}
