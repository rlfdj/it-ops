import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { ArrowUpRightIcon } from "lucide-react";
import { formatDate, todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { formatShortDate } from "@/lib/format";
import { KIND_LABEL, progress, SECTION_LABEL, SECTION_ORDER } from "@/lib/checklists";
import {
  getChecklistItems,
  listChecklists,
  getChecklistTemplates,
  listPeople,
  type ChecklistSummary,
} from "@/lib/queries/checklists";
import { listSeatsOfPerson } from "@/lib/queries/seats";
import { seatSummary } from "@/lib/seat-roster";
import { subscriptionHref } from "@/lib/links";
import { ChecklistItem } from "./checklist-item";
import { AddChecklistItem, DeleteChecklist, NewChecklist } from "./checklist-dialogs";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const when = (c: ChecklistSummary, today: string) => {
  const d = formatShortDate(c.targetDate, today);
  if (c.kind === "onboarding") return c.targetDate > today ? `starts ${d}` : `started ${d}`;
  return c.targetDate >= today ? `leaves ${d}` : `left ${d}`;
};

export async function OnboardingView({ params }: { params: Params }) {
  const today = todayIn((await getWorkspaceSettings()).timeZone);
  const [checklists, people, templates] = await Promise.all([
    listChecklists(today),
    listPeople(),
    getChecklistTemplates(),
  ]);
  const open = checklists.filter((c) => c.status === "open");
  const overdueItems = open.reduce((n, c) => n + c.overdue, 0);
  const completedCount = checklists.filter((c) => c.status === "completed").length;
  const completed = checklists
    .filter((c) => c.status === "completed")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 8);

  // ?checklist=id, or ?person=id (their most recent checklist), or the first open one.
  const personParam = one(params.person);
  const selected =
    checklists.find((c) => c.id === one(params.checklist)) ??
    (personParam
      ? [...checklists].reverse().find((c) => c.person.id === personParam)
      : undefined) ??
    open[0] ??
    null;
  const personWithoutChecklist =
    personParam && !checklists.some((c) => c.person.id === personParam)
      ? people.find((p) => p.id === personParam)
      : undefined;
  const [items, heldSeats] = selected
    ? await Promise.all([getChecklistItems(selected.id), listSeatsOfPerson(selected.person)])
    : [[], []];
  const p = progress(items, today);

  const sections = SECTION_ORDER.map((section) => ({
    section,
    items: items.filter((i) => i.section === section),
  })).filter((s) => s.items.length > 0);

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">
            {open.length} in progress · {overdueItems} overdue · {completedCount} completed
          </span>
          <h1 className="h1">On / Offboarding</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-7">
        <section
          className="flex min-w-0 flex-[0_0_100%] flex-col gap-2.5 min-[1024px]:flex-[0_0_272px]"
          aria-label="People"
        >
          <span className="eyebrow px-3">In progress</span>
          {open.length === 0 ? (
            <p className="m-0 px-3 text-ink3">No open checklists. Press N to start one.</p>
          ) : (
            <div className="people">
              {open.map((c) => (
                <Link
                  key={c.id}
                  href={`/onboarding?checklist=${c.id}`}
                  className="person"
                  aria-current={selected?.id === c.id ? "page" : undefined}
                  scroll={false}
                >
                  <span className="nm">
                    <span>{c.person.name}</span>
                    <span className="cap">
                      {c.done} / {c.total}
                    </span>
                  </span>
                  <span className="cap">
                    {KIND_LABEL[c.kind]} · {when(c, today)}
                  </span>
                  <span className="bar">
                    <span style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%` }} />
                  </span>
                  {c.overdue ? (
                    <span className="st urgent c-red cap">{c.overdue} overdue</span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
          {completed.length ? (
            <>
              <span className="eyebrow px-3 pt-[18px]">Completed</span>
              <div className="flex flex-col gap-0.5 px-3 text-ink3">
                {completed.map((c) => (
                  <Link
                    key={c.id}
                    href={`/onboarding?checklist=${c.id}`}
                    className="flex justify-between gap-2 py-1.5 text-ink3"
                    scroll={false}
                  >
                    <span>
                      {c.person.name} · {KIND_LABEL[c.kind]}
                    </span>
                    <span>{formatShortDate(c.targetDate, today)}</span>
                  </Link>
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section
          className="flex min-w-0 flex-[1_1_0] flex-col gap-6 max-[1023px]:flex-[1_1_100%]"
          aria-label="Checklist"
        >
          {personWithoutChecklist ? (
            <EmptyState
              title={`${personWithoutChecklist.name} has no checklist`}
              actions={[{ label: "New checklist", href: "/onboarding?new=1", primary: true }]}
            >
              Start an on- or offboarding checklist for them.
            </EmptyState>
          ) : !selected ? (
            <EmptyState
              title="No checklist selected"
              actions={[{ label: "New checklist", href: "/onboarding?new=1", primary: true }]}
            >
              Start an onboarding or offboarding checklist.
            </EmptyState>
          ) : (
            <>
              <div className="page-head items-end!">
                <div className="title">
                  <span className="eyebrow">
                    {KIND_LABEL[selected.kind]} checklist
                    {selected.status === "completed" ? " · completed" : ""}
                  </span>
                  <h2 className="h1">{selected.person.name}</h2>
                  <span className="cap">
                    {[
                      selected.person.department,
                      `${selected.kind === "onboarding" ? "Starts" : "Last day"} ${formatDate(selected.targetDate)}`,
                      selected.person.managerName ? `Manager ${selected.person.managerName}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="right items-center!">
                  <a
                    className="btn"
                    href={`/handover/${selected.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print handover form
                    <ArrowUpRightIcon size={13} aria-hidden />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <DeleteChecklist checklistId={selected.id} />
                  <AddChecklistItem checklistId={selected.id} defaultDue={selected.targetDate} />
                </div>
              </div>

              {heldSeats.length ? (
                <div
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                  data-testid="person-seats"
                >
                  <span className="eyebrow">Seats held</span>
                  {heldSeats.map((seat) => (
                    <Link
                      key={seat.id}
                      href={subscriptionHref(seat.subscriptionId)}
                      className="underline"
                    >
                      {seatSummary(seat)}
                    </Link>
                  ))}
                </div>
              ) : null}

              <div className="flex items-center gap-4">
                <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
                  <span className="fig md">{p.done}</span>
                  <span className="cap">/ {p.total}</span>
                </span>
                <span
                  className="bar flex-1"
                  role="progressbar"
                  aria-valuenow={p.done}
                  aria-valuemin={0}
                  aria-valuemax={p.total}
                  aria-label="Checklist progress"
                >
                  <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
                </span>
                <span className="cap whitespace-nowrap">
                  {p.open
                    ? `${p.open} open ${p.open === 1 ? "item is" : "items are"} in Tasks`
                    : "All done"}
                </span>
              </div>

              <div className="grid grid-cols-1 items-start gap-x-8 min-[1024px]:grid-cols-2">
                {sections.map((s) => {
                  const hasPieces = s.items.some((i) => i.children.length > 0);
                  // Equipment shows pieces (leaf items), not the one parent row.
                  const sp = progress(
                    hasPieces
                      ? s.items.flatMap((i) => (i.children.length ? i.children : [i]))
                      : s.items,
                    today,
                  );
                  return (
                    <section key={s.section} className="min-w-0">
                      <div className="group-head">
                        <b>{SECTION_LABEL[s.section]}</b>
                        <span className="right">
                          {sp.done} / {sp.total}
                          {hasPieces ? " pieces" : ""}
                        </span>
                      </div>
                      {s.items.map((item) => (
                        <ChecklistItem
                          key={item.id}
                          item={item}
                          checklistId={selected.id}
                          today={today}
                          equipment={s.section === "assets"}
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      <NewChecklist
        key={JSON.stringify(templates)}
        open={one(params.new) === "1"}
        people={people}
        today={today}
        templates={templates}
      />
    </main>
  );
}
