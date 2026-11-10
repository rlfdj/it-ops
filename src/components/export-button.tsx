/**
 * "Export CSV" with one rule for every list (B-25): always there; disabled, with the reason,
 * when there is nothing to export.
 */
export function ExportButton({
  href,
  empty = false,
  emptyReason = "Nothing to export yet",
  title,
}: {
  href: string;
  empty?: boolean;
  emptyReason?: string;
  title?: string;
}) {
  if (empty)
    return (
      <button type="button" className="btn" disabled title={emptyReason}>
        Export CSV
      </button>
    );
  return (
    <a className="btn" href={href} download title={title}>
      Export CSV
    </a>
  );
}
