import Link from "@/components/link";
import { actorName, timeParts } from "@/lib/activity";
import { addDays, daysBetween, formatDate, todayIn } from "@/lib/dates";
import {
  agoLabel,
  ATTENTION_CAP,
  dueThisMonth,
  expectedTotal,
  plural,
  rankAttention,
} from "@/lib/dashboard";
import { formatMoney, formatShortDate } from "@/lib/format";
import { DOC_LABEL } from "@/lib/procurement";
import { poHref, subscriptionHref } from "@/lib/links";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { getDashboardData } from "@/lib/queries/dashboard";
import { listActivity } from "@/lib/queries/activity";
import { listTasks } from "@/lib/queries/tasks";
import { ActivitySentence } from "@/components/activity/activity-sentence";
import { DashboardTasks } from "./dashboard-tasks";
import { RenewalsPanel } from "./renewals-panel";

function greeting(now: Date, timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(now),
  );
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** "10:42" today, "Yest. 17:20", then "11 Oct". */
function feedTime(at: Date, today: string, timeZone: string) {
  const { date, time } = timeParts(at, timeZone);
  if (date === today) return time;
  if (date === addDays(today, -1)) return `Yest. ${time}`;
  return formatShortDate(date, today);
}

export async function DashboardView({ name }: { name: string }) {
  const now = new Date();
  const { timeZone, baseCurrency } = await getWorkspaceSettings();
  const today = todayIn(timeZone, now);
  const [data, tasks, recent] = await Promise.all([
    getDashboardData(today),
    listTasks(),
    listActivity({ module: null, from: null, to: null, q: null }, 7),
  ]);

  const openTasks = tasks.filter((t) => t.status !== "done");
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today).length;
  const thisMonth = data.renewals
    .filter((r) => dueThisMonth(r.due, today))
    .sort((a, b) => a.due.localeCompare(b.due));
  const expectedThisMonth = expectedTotal(thisMonth);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    new Date(`${today}T00:00:00Z`),
  );
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone,
  }).format(now);
  const nextIn = thisMonth[0] ? daysBetween(today, thisMonth[0].due) : null;

  const ago = (date: string) => agoLabel(daysBetween(date, today));
  const attentionAll = rankAttention([
    ...data.posMissingDocs.map((p) => {
      const red = p.missing.includes("delivery_note");
      return {
        key: `po-${p.id}`,
        kind: "po" as const,
        severity: red ? ("red" as const) : ("amber" as const),
        ageDays: daysBetween(p.requestedOn, today),
        ref: (
          <Link className="lnk ref trunc" href={poHref(p.poNumber)} title={p.poNumber}>
            {p.poNumber}
          </Link>
        ),
        what: `${p.missing.map((k, i) => (i ? DOC_LABEL[k].toLowerCase() : DOC_LABEL[k]) + (k === "approval" ? " file" : "")).join(", ")} missing`,
        detail: `${p.vendor} · requested ${ago(p.requestedOn)}`,
        action: { label: "Attach", href: poHref(p.poNumber) },
      };
    }),
    ...data.uncollected.map((u) => ({
      key: `eq-${u.checklistId}`,
      kind: "equipment" as const,
      severity: "red" as const,
      ageDays: daysBetween(u.lastDay, today),
      ref: (
        <Link
          className="link ref trunc"
          href={`/onboarding?checklist=${u.checklistId}`}
          title={u.personName}
        >
          {u.personName}
        </Link>
      ),
      what: `${plural(u.items.length, "item")} not collected`,
      detail: `${u.items.join(", ")} · left ${ago(u.lastDay)}`,
      action: { label: "Open", href: `/onboarding?checklist=${u.checklistId}` },
    })),
    ...data.missingInvoices.map((m) => ({
      key: `inv-${m.subscriptionId}`,
      kind: "invoice" as const,
      severity: "red" as const,
      ageDays: daysBetween(m.since, today),
      ref: (
        <Link className="link ref trunc" href={subscriptionHref(m.subscriptionId)} title={m.name}>
          {m.name}
        </Link>
      ),
      what:
        m.periods.length === 1
          ? `${m.periods[0]} invoice missing`
          : `Missing ${plural(m.periods.length, "period")}`,
      detail: `${m.periods.length > 1 ? `${m.periods.join(", ")}` : ""}${
        m.amountAed == null
          ? ""
          : `${m.periods.length > 1 ? " · " : ""}${baseCurrency} ${formatMoney(m.amountAed)}`
      }`,
      action: { label: "Upload", href: subscriptionHref(m.subscriptionId) },
    })),
  ]);
  const attention = attentionAll.slice(0, ATTENTION_CAP);
  const hidden = attentionAll.slice(ATTENTION_CAP);
  const hiddenLinks = [
    { kind: "po", one: "purchase", many: "purchases", href: "/procurement?missing=1" },
    {
      kind: "invoice",
      one: "subscription",
      many: "subscriptions",
      href: "/subscriptions?missing=1",
    },
    { kind: "equipment", one: "offboarding", many: "offboardings", href: "/onboarding" },
  ]
    .map((l) => ({ ...l, n: hidden.filter((h) => h.kind === l.kind).length }))
    .filter((l) => l.n > 0);

  const status = [
    { n: overdue, text: `${plural(overdue, "task")} overdue`, tone: "c-red", href: "/tasks" },
    {
      n: thisMonth.length,
      text: `${plural(thisMonth.length, "renewal")} due in ${monthName}`,
      tone: "c-amber",
      href: "/subscriptions?due=month",
    },
    {
      n: data.posMissingDocs.length,
      text: `${plural(data.posMissingDocs.length, "PO")} missing ${plural(
        data.posMissingDocs.reduce((n, p) => n + p.missing.length, 0),
        "document",
      )}`,
      tone: "c-red",
      href: "/procurement?missing=1",
    },
  ];

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="eyebrow">
            {weekday}, {formatDate(today)}
          </span>
          <h1 className="h2 lg">
            {greeting(now, timeZone)}, {name}
          </h1>
        </div>
        <nav className="signals" aria-label="Needs you today">
          {status.map((s) => (
            <Link key={s.text} href={s.href} className={`chip signal ${s.n ? s.tone : "c-grey"}`}>
              {s.text}
            </Link>
          ))}
        </nav>
      </div>

      <section aria-label="Key numbers" className="stat-band hero ruled">
        <Link className="stat" href="/stock">
          <span className="l">In stock</span>
          <span className="v">{data.stock.count}</span>
          <span className="s">{plural(data.stock.models, "model")}</span>
        </Link>
        <Link className="stat" href="/procurement">
          <span className="l">Open POs</span>
          <span className="v">{data.openPos.count}</span>
          <span className="s">
            {baseCurrency} {formatMoney(data.openPos.totalAed)}
          </span>
        </Link>
        <Link className="stat" href="/procurement?stage=requested">
          <span className="l">Awaiting approval file</span>
          <span className="v">{data.awaitingApproval.count}</span>
          <span className="s">
            {baseCurrency} {formatMoney(data.awaitingApproval.totalAed)} · attach to approve
          </span>
        </Link>
        <Link className="stat" href="/subscriptions?due=month">
          <span className="l">Renewals this month</span>
          <span className="v">{thisMonth.length}</span>
          <span className="s">
            {expectedThisMonth === null
              ? "No expected costs"
              : `${baseCurrency} ${formatMoney(expectedThisMonth)} expected`}
            {nextIn !== null
              ? ` · next ${nextIn === 0 ? "today" : `in ${plural(nextIn, "day")}`}`
              : ""}
          </span>
        </Link>
      </section>

      {/* Two independent columns, so a short section never leaves a gap under it. Below
          1024px they stack: tasks, needs attention, renewals, activity. */}
      <div className="grid grid-cols-[minmax(0,1fr)_470px] items-start gap-x-12 gap-y-9 max-[1023px]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-10 max-[1023px]:gap-9">
          <DashboardTasks tasks={openTasks} today={today} />

          <section aria-label="Needs attention" className="flex min-w-0 flex-col">
            <div className="sec-head">
              <div className="lead">
                <h2 className="h2">Needs attention</h2>
                <span className="cap">Missing documents and loose ends</span>
              </div>
            </div>
            <div>
              {attention.map((a) => (
                <div key={a.key} className="att">
                  {a.ref}
                  <div className="desc">
                    <span className={`st c-${a.severity}`}>{a.what}</span>
                    <span> · {a.detail}</span>
                  </div>
                  <Link className="btn sm" href={a.action.href}>
                    {a.action.label}
                  </Link>
                </div>
              ))}
              {hiddenLinks.length ? (
                <p className="cap m-0 flex flex-wrap gap-x-4 py-3">
                  {hiddenLinks.map((l) => (
                    <Link key={l.kind} href={l.href} className="link whitespace-nowrap">
                      {l.n} more {l.n === 1 ? l.one : l.many} →
                    </Link>
                  ))}
                </p>
              ) : null}
              {attention.length === 0 ? (
                <p className="cap m-0 py-4">All caught up: no missing documents or loose ends.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-10 max-[1023px]:gap-9">
          <RenewalsPanel renewals={data.renewals} today={today} />

          <section aria-label="Recent activity" className="flex min-w-0 flex-col">
            <div className="sec-head">
              <div className="lead">
                <h2 className="h2">Recent activity</h2>
              </div>
              <Link href="/activity" className="link whitespace-nowrap">
                Full log →
              </Link>
            </div>
            <div>
              {recent.map((e) => (
                <div key={e.id} className="feed">
                  <span className="cap">{feedTime(e.at, today, timeZone)}</span>
                  <ActivitySentence entry={e} actor={actorName(e.actor)} showChange={false} />
                </div>
              ))}
              {recent.length === 0 ? <p className="cap m-0 py-4">No activity yet.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
