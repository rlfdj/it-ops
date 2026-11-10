/** Placeholder for a module that is built in a later phase. */
export function ComingSoon({
  title,
  phase,
  children,
}: {
  title: string;
  phase: number;
  children?: React.ReactNode;
}) {
  return (
    <main id="content" tabIndex={-1} className="page">
      <h1 className="h1">{title}</h1>
      <div className="flex flex-col gap-1.5 border-t border-line pt-5">
        <span className="eyebrow">Phase {phase}</span>
        <p className="m-0 text-ink2">{children ?? "This screen is built in a later phase."}</p>
      </div>
    </main>
  );
}
