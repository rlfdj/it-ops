import Link from "@/components/link";
import { describe, type LogEntry } from "@/lib/activity";
import { personHref, poHref, subscriptionHref } from "@/lib/links";

const links = {
  po: poHref,
  subscription: subscriptionHref,
  checklist: (id: string) => `/onboarding?checklist=${encodeURIComponent(id)}`,
  person: personHref,
};

/** "Moved PO-2026-0158 to Approved" with the record linked, and an optional change line. */
export function ActivitySentence({
  entry,
  showChange = true,
  actor,
}: {
  entry: LogEntry;
  showChange?: boolean;
  /** Leads with the actor's name ("Alex moved …"), as in the dashboard feed. */
  actor?: string;
}) {
  const s = describe(entry, links);
  const verb = actor ? s.verb.charAt(0).toLowerCase() + s.verb.slice(1) : s.verb;
  // Show a checklist item label as a medium-weight span instead of inside curly quotes
  // (equipment labels end in an inch mark, which collides with the closing quote).
  const quoted = s.item ? `“${s.item}”` : null;
  const at = quoted ? verb.indexOf(quoted) : -1;
  const verbNode =
    quoted && at >= 0 ? (
      <>
        {verb.slice(0, at)}
        <span className="font-medium">{s.item}</span>
        {verb.slice(at + quoted.length)}
      </>
    ) : (
      verb
    );
  return (
    <span className="flex min-w-0 flex-col gap-[3px]">
      <span>
        {actor ? <b className="font-semibold">{actor} </b> : null}
        {verbNode}{" "}
        {s.ref ? (
          s.ref.href ? (
            <Link href={s.ref.href} className={s.ref.mono ? "id" : undefined}>
              {s.ref.label}
            </Link>
          ) : (
            <span className={s.ref.mono ? "id" : "font-medium"}>{s.ref.label}</span>
          )
        ) : null}
        {s.rest ? <span className="text-ink2"> {s.rest}</span> : null}
      </span>
      {showChange && s.change ? (
        <span className="chg">
          {s.change.field}: {s.change.from} → <b>{s.change.to}</b>
        </span>
      ) : null}
    </span>
  );
}
