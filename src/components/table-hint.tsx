/** One line of keyboard hints under or beside a table, built from what the table can do. */
export type Hint = { keys: string[]; label: string };

export function TableHint({ hints, className = "" }: { hints: Hint[]; className?: string }) {
  return (
    <p className={`cap table-hint m-0 max-[760px]:hidden ${className}`}>
      {hints.map((h, i) => (
        <span key={h.label}>
          {i ? " · " : ""}
          {h.keys.map((k) => (
            <span key={k} className="kbd mr-0.5">
              {k}
            </span>
          ))}{" "}
          {h.label}
        </span>
      ))}
    </p>
  );
}
