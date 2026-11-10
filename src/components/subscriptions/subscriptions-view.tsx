import { isTieredSubscription, tierSummary } from "@/lib/seat-tiers";
import { seatsForInvoice } from "@/lib/seat-roster";
import { listSeats } from "@/lib/queries/seats";
import { addedSeatsLabel, prefillSeats, seatCountsLabel } from "@/lib/subscription-seats";
import { DetailSheet } from "@/components/detail-sheet";
import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { SYSTEM_ACTOR, withActor } from "@/db";
import { Aed } from "@/components/aed";
import { ExportButton } from "@/components/export-button";
import { ListFilter } from "@/components/list-controls";
import { ViewTabs } from "@/components/view-tabs";
import { filterRows, parseSort, sortParam, sortRows, textParam } from "@/lib/list-view";
import { keysOf, SUB_SORT_COLUMNS, SUB_SORTS, subSearchFields } from "@/lib/list-sorts";
import { daysBetween, formatDate, todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { formatMoney, formatShortDate } from "@/lib/format";
import { billingCurrency } from "@/lib/config";
import { dueThisMonth, renewalDue } from "@/lib/dashboard";
import {
  billingLabel,
  decisionTone,
  proratedLabel,
  relativeDays,
  shortPeriodLabel,
  layoutStripLane,
  STRIP_LABEL_W,
  stripDate,
  stripMonths,
  stripPosition,
  STRIP_DAYS,
} from "@/lib/subscriptions";
import {
  getPaidTotals,
  listInvoices,
  listPersonNames,
  listSeatSources,
  listSubscriptions,
  type SubscriptionRow,
} from "@/lib/queries/subscriptions";
import { listVendors } from "@/lib/queries/procurement";
import { ensureInvoicePeriods } from "@/server/subscriptions";
import { ImportSubscriptions } from "./import-subscriptions-dialog";
import { SubsTable, type SubTableRow } from "./subs-table";
import {
  AddInvoice,
  AutoRenewSwitch,
  EditSubscription,
  InvoiceRemove,
  InvoiceUpload,
  MissingToggle,
  NewSubscription,
} from "./controls";
import { LedgerRow } from "./ledger-row";
import { SeatsSection } from "./seats-section";
import { PanelTabs } from "./panel-tabs";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const KIND_FILTERS = [
  { value: null, label: "All" },
  { value: "subscription", label: "Subscriptions" },
  { value: "contract", label: "Contracts" },
] as const;

const KIND_LABEL = { subscription: "Subscription", contract: "Contract" } as const;
/** " · billed USD 12.00" for a USD subscription (the base currency amount is shown first). */
const usd = (s: { currency: string; costOriginal: number | null }, base: string) =>
  s.currency === "USD" && base !== "USD" && s.costOriginal != null
    ? ` · billed USD ${formatMoney(s.costOriginal)}`
    : "";

// Lane centres inside the 92px track (px); each lane has room for a second line of labels.
const LANES = [
  { id: "annual", top: 23 },
  { id: "contract", top: 69 },
] as const;

export async function SubscriptionsView({ params }: { params: Params }) {
  const { timeZone, baseCurrency } = await getWorkspaceSettings();
  const today = todayIn(timeZone);
  // Business rule 4: roll billing periods forward (idempotent) before reading.
  try {
    await withActor(SYSTEM_ACTOR, (tx) => ensureInvoicePeriods(tx, today));
  } catch (error) {
    console.error("ensureInvoicePeriods failed", error);
  }

  const kindParam = one(params.kind);
  const kind = kindParam === "subscription" || kindParam === "contract" ? kindParam : null;
  const onlyMissing = one(params.missing) === "1";
  const dueMonth = one(params.due) === "month";
  const q = textParam(params.q);
  const sort = parseSort(one(params.sort), keysOf(SUB_SORT_COLUMNS));
  const [all, vendorRows, paid, people] = await Promise.all([
    listSubscriptions(),
    listVendors(),
    getPaidTotals(today),
    listPersonNames(),
  ]);
  const vendors = vendorRows.map((v) => v.name);
  const active = all.filter((s) => s.active);

  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(
    new Date(`${today}T00:00:00Z`),
  );
  // Kind counts follow the text, "missing" and "due this month" filters, so the numbers agree with the list.
  // "Due this month" counts what the dashboard counted: active, due from today to month end.
  const matched = filterRows(all, q, subSearchFields).filter((s) => {
    if (onlyMissing && s.missing === 0) return false;
    if (dueMonth) {
      const due = s.active ? renewalDue({ ...s }) : null;
      if (!due || !dueThisMonth(due, today)) return false;
    }
    return true;
  });
  const filtered = Boolean(q) || onlyMissing || dueMonth;
  const rows = sortRows(
    matched.filter((s) => !kind || s.kind === kind),
    sort,
    SUB_SORTS,
  );
  const selectedId = one(params.sub) ?? rows[0]?.id ?? null;
  const selected = all.find((s) => s.id === selectedId) ?? null;
  const selectedPreset = selected && isTieredSubscription(selected) ? true : null;
  const [invoices, seatSources, roster] = selected
    ? await Promise.all([
        listInvoices(selected),
        selectedPreset ? listSeatSources(selected.id) : Promise.resolve([]),
        listSeats(selected.id),
      ])
    : [[], [], []];
  const activeSeats = roster.filter((r) => r.until === null).length;
  const seatFallback = {
    standard: selected?.seatsStandard ?? null,
    premium: selected?.seatsPremium ?? null,
  };
  /** Standard / Premium now: the roster's active seats, else the last renewal invoice's counts plus seats added since. */
  const currentSeats = selectedPreset
    ? seatsForInvoice(roster, today, () => prefillSeats(seatSources, seatFallback))
    : null;

  // Summary band
  const missingTotal = active.reduce((n, s) => n + s.missing, 0);
  const missingSubs = active.filter((s) => s.missing > 0).length;
  const nextUp = active
    .filter((s) => s.nextChargeDate && s.nextChargeDate >= today)
    .sort((a, b) => a.nextChargeDate!.localeCompare(b.nextChargeDate!))[0];

  // 90-day strip: annual renewals and contract ends
  const marks = active
    .map((s) => ({ s, date: stripDate({ ...s, cycle: s.billingCycle }) }))
    .filter((m): m is { s: SubscriptionRow; date: string } => {
      if (!m.date) return false;
      const d = daysBetween(today, m.date);
      return d >= 0 && d <= STRIP_DAYS;
    });

  const query = new URLSearchParams();
  if (kind) query.set("kind", kind);
  if (onlyMissing) query.set("missing", "1");
  if (dueMonth) query.set("due", "month");
  if (q) query.set("q", q);
  if (sort) query.set("sort", sortParam(sort)!);
  const subHref = (id: string) => {
    const q = new URLSearchParams(query);
    q.set("sub", id);
    return `/subscriptions?${q}`;
  };
  const kindHref = (value: string | null) => {
    const q = new URLSearchParams(query);
    if (value) q.set("kind", value);
    else q.delete("kind");
    return q.size ? `/subscriptions?${q}` : "/subscriptions";
  };

  const tableRows: SubTableRow[] = rows.map((s) => {
    const days = s.nextChargeDate ? daysBetween(today, s.nextChargeDate) : null;
    const presetRow = isTieredSubscription(s);
    const counts = presetRow
      ? seatCountsLabel(
          s.lastPaidDate ? s.lastPaidStandard : s.seatsStandard,
          s.lastPaidDate ? s.lastPaidPremium : s.seatsPremium,
        )
      : null;
    return {
      id: s.id,
      name: s.name,
      detail: presetRow
        ? [s.vendor, counts].filter(Boolean).join(" · ")
        : [s.vendor, s.plan, s.seats ? `${s.seats} seats` : null].filter(Boolean).join(" · "),
      lastPaid:
        s.lastPaidDate && s.lastPaidAed != null
          ? {
              aed: s.lastPaidAed,
              date: formatShortDate(s.lastPaidDate, today),
              title: [
                `Last paid ${formatDate(s.lastPaidDate)}`,
                seatCountsLabel(s.lastPaidStandard, s.lastPaidPremium),
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : null,
      nextDate: s.nextChargeDate ? formatShortDate(s.nextChargeDate, today) : "—",
      nextLeft: !s.active ? "inactive" : days === null ? "" : relativeDays(days),
      tone: !s.active ? "grey" : decisionTone(s, today),
      invoiceText: s.missing ? `${s.missing} missing` : s.onFile ? "All on file" : "None yet",
      invoiceState: s.missing ? "missing" : s.onFile ? "on_file" : "upcoming",
      inactive: !s.active,
    };
  });

  const invoicesSection = selected ? (
    <section className="panel-section">
      <div className="ps-head">
        <span className="eyebrow">Invoices</span>
        <span className="muted text-[12px]">
          {selected.onFile} on file
          {selected.missing ? ` · ${selected.missing} missing` : ""}
        </span>
        <AddInvoice
          subscriptionId={selected.id}
          billingCycle={selected.billingCycle}
          currency={billingCurrency(selected.currency, baseCurrency)}
          amount={selected.costOriginal}
          today={today}
          preset={Boolean(selectedPreset)}
          seatSources={seatSources}
          seatFallback={seatFallback}
          roster={roster}
          people={people}
        />
      </div>
      {invoices.length === 0 ? (
        <p className="m-0 py-4 text-ink3">No billing periods yet.</p>
      ) : (
        <div role="table" aria-label="Invoice ledger" className="ledger">
          {invoices.map((iv) => {
            const label =
              iv.kind === "prorated"
                ? proratedLabel(iv.periodStart)
                : shortPeriodLabel(selected.billingCycle, iv.periodStart);
            const counts =
              iv.kind === "renewal" && selectedPreset
                ? seatCountsLabel(iv.seatsStandard, iv.seatsPremium)
                : null;
            const added =
              iv.kind === "prorated" ? addedSeatsLabel(iv.seats.map((s) => s.tier)) : "";
            // A renewal row's counts: its own, else what the next invoice would start from.
            const rowCounts =
              iv.kind === "renewal" && selectedPreset
                ? iv.seatsStandard != null || iv.seatsPremium != null
                  ? {
                      standard: iv.seatsStandard ?? 0,
                      premium: iv.seatsPremium ?? 0,
                    }
                  : seatsForInvoice(roster, iv.periodStart, () =>
                      prefillSeats(seatSources, seatFallback, iv.periodStart),
                    )
                : null;
            return (
              <LedgerRow
                key={iv.id}
                label={label}
                seats={iv.kind === "prorated" ? iv.seats : undefined}
                detail={
                  <>
                    {added || counts ? <span className="text-ink2">{added || counts}</span> : null}
                    {added || counts
                      ? iv.status === "upcoming" || iv.invoiceNumber
                        ? " · "
                        : ""
                      : null}
                    {iv.status === "upcoming"
                      ? `Due ${formatShortDate(iv.periodStart, today)}`
                      : added || counts
                        ? iv.invoiceNumber
                        : (iv.invoiceNumber ?? "—")}
                    {iv.documentName ? (
                      <span className="sr-only"> · file {iv.documentName}</span>
                    ) : null}
                  </>
                }
                amount={
                  iv.amountAed == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <Aed value={iv.amountAed} />
                      {selected.currency === "USD" &&
                      baseCurrency !== "USD" &&
                      iv.amountOriginal != null ? (
                        <span className="muted text-[11px]">
                          USD {formatMoney(iv.amountOriginal)}
                        </span>
                      ) : null}
                    </>
                  )
                }
                status={
                  <span
                    className={`mark ${iv.status === "on_file" ? "ok" : iv.status === "missing" ? "miss" : "up"}`}
                  >
                    {iv.status === "on_file"
                      ? "On file"
                      : iv.status === "missing"
                        ? "Missing"
                        : "Upcoming"}
                  </span>
                }
                acts={
                  <>
                    {iv.status !== "upcoming" ? (
                      <InvoiceUpload
                        invoiceId={iv.id}
                        periodLabel={iv.periodLabel}
                        currency={billingCurrency(selected.currency, baseCurrency)}
                        amount={iv.amountOriginal}
                        seatCounts={rowCounts}
                        roster={roster}
                        periodStart={iv.periodStart}
                        replace={Boolean(iv.documentId)}
                        documentId={iv.documentId}
                        documentName={iv.documentName}
                      />
                    ) : null}
                    <InvoiceRemove
                      invoiceId={iv.id}
                      label={label}
                      prorated={iv.kind === "prorated"}
                      documentName={iv.documentId ? (iv.documentName ?? "the file") : null}
                    />
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </section>
  ) : null;

  return (
    <main id="content" tabIndex={-1} className="page">
      <div className="page-head">
        <div className="title">
          <span className="eyebrow">Recurring charges · invoices · contracts</span>
          <h1 className="h1">Subscriptions</h1>
        </div>
        <div className="right">
          <ImportSubscriptions />
          <ExportButton
            href={q ? `/subscriptions/export?q=${encodeURIComponent(q)}` : "/subscriptions/export"}
            empty={all.length === 0}
            title={q ? "Exports the subscriptions matching the filter text" : undefined}
          />
        </div>
      </div>

      <section className="stat-band" aria-label="Summary">
        <div className="stat">
          <span className="l">Paid this month</span>
          <span className="v">
            <Aed value={paid.month} />
          </span>
          <span className="s">Invoices on file for {monthName}</span>
        </div>
        <div className="stat">
          <span className="l">Paid this year</span>
          <span className="v">
            <Aed value={paid.year} />
          </span>
          <span className="s">Invoices on file for {today.slice(0, 4)}</span>
        </div>
        <div className={`stat${missingTotal ? " red" : ""}`}>
          <span className="l">Invoices missing</span>
          <span className="v">{missingTotal}</span>
          <span className="s">
            {missingSubs
              ? `Across ${missingSubs} ${missingSubs === 1 ? "subscription" : "subscriptions"}`
              : "All on file"}
          </span>
        </div>
        <div className="stat">
          <span className="l">Next charge</span>
          {nextUp ? (
            <>
              <Link
                href={subHref(nextUp.id)}
                className="v text truncate text-ink hover:no-underline"
                scroll={false}
              >
                {nextUp.name}
              </Link>
              <span className="s">
                {formatShortDate(nextUp.nextChargeDate!, today)}
                {nextUp.costAed != null
                  ? ` · ${baseCurrency} ${formatMoney(nextUp.costAed)} expected`
                  : ""}
                {" · "}
                {relativeDays(daysBetween(today, nextUp.nextChargeDate!))}
              </span>
            </>
          ) : (
            <span className="v text text-ink3">Nothing scheduled</span>
          )}
        </div>
      </section>

      <section
        aria-label={`Renewals and contract ends in the next ${STRIP_DAYS} days`}
        className="flex flex-col gap-2"
      >
        <div className="flex justify-between">
          <span className="eyebrow">Renewals &amp; contract ends · next {STRIP_DAYS} days</span>
          <span className="muted flex gap-3.5 text-[12px] max-[760px]:hidden">
            <span className="st c-red">Act ≤ 14 days</span>
            <span className="st c-amber">≤ 30 days</span>
            <span className="st c-grey">Later or routine</span>
          </span>
        </div>
        <p className="cap m-0 max-[760px]:hidden">
          Contract ends and manual renewals turn red within 14 days; auto-renewing plans never go
          past amber; monthly auto-renew charges stay grey.
        </p>
        <div className="flex flex-col gap-2 max-[760px]:hidden">
          <div className="grid grid-cols-[96px_minmax(0,1fr)] items-stretch gap-3">
            <div className="flex flex-col justify-around text-[12px] text-ink3 max-[760px]:text-[11px]">
              <span>Annual plans</span>
              <span>Contracts</span>
            </div>
            <div className="track">
              <div className="zone left-0 w-1/3" aria-hidden />
              {LANES.map((l) => (
                <div key={l.id} className="lane" style={{ top: l.top }} aria-hidden />
              ))}
              <div className="today left-0" aria-hidden />
              {stripMonths(today).map((m) => (
                <div
                  key={m.label}
                  className="absolute inset-y-0 w-px bg-line2"
                  style={{ left: `${m.left}%` }}
                  aria-hidden
                />
              ))}
              {LANES.flatMap((lane) =>
                layoutStripLane(
                  marks
                    .filter(({ s }) => (s.kind === "contract" ? "contract" : "annual") === lane.id)
                    .map((m) => ({ ...m, pos: stripPosition(m.date, today) })),
                ).map((entry) => {
                  // Row 0 sits beside the dot; row 1 hangs under it, one line down.
                  const edge = entry.row === 0 ? 10 : -5;
                  const labelStyle = {
                    ...(entry.flip
                      ? { right: `calc(${100 - entry.pos}% + ${edge}px)` }
                      : { left: `calc(${entry.pos}% + ${edge}px)` }),
                    top: entry.row === 0 ? lane.top - 8 : lane.top + 10,
                    maxWidth: `${STRIP_LABEL_W}%`,
                    textAlign: entry.flip ? ("right" as const) : ("left" as const),
                  };
                  const describe = ({ s, date }: (typeof marks)[number]) =>
                    `${s.name} · ${s.kind === "contract" ? "contract ends" : "renews"} ${formatDate(date)} · ${relativeDays(daysBetween(today, date))}`;
                  if (entry.items.length > 1) {
                    const tones = entry.items.map(({ s }) => decisionTone(s, today));
                    const tone = tones.includes("red")
                      ? "red"
                      : tones.includes("amber")
                        ? "amber"
                        : "grey";
                    return (
                      <div
                        key={`g-${lane.id}-${entry.items[0]!.s.id}`}
                        className={`mk-grp c-${tone}`}
                        style={{ left: `${entry.pos}%`, top: lane.top }}
                        tabIndex={0}
                        role="group"
                        aria-label={`${entry.items.length} marks close together: ${entry.items.map(({ s }) => s.name).join(", ")}`}
                        data-testid="strip-group"
                      >
                        <span aria-hidden>{entry.items.length}</span>
                        <ul className="mk-pop">
                          {entry.items.map((m) => (
                            <li key={m.s.id}>
                              <Link
                                href={subHref(m.s.id)}
                                replace
                                scroll={false}
                                className={m.s.id === selected?.id ? "font-semibold" : undefined}
                                aria-current={m.s.id === selected?.id ? "true" : undefined}
                              >
                                <span
                                  className={`mk-dot c-${decisionTone(m.s, today)}`}
                                  aria-hidden
                                />
                                {describe(m)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }
                  const m = entry.items[0]!;
                  const label = describe(m);
                  return [
                    <Link
                      key={m.s.id}
                      href={subHref(m.s.id)}
                      replace
                      scroll={false}
                      className={`mk c-${decisionTone(m.s, today)}`}
                      aria-current={m.s.id === selected?.id ? "true" : undefined}
                      style={{ left: `${entry.pos}%`, top: lane.top }}
                      aria-label={label}
                      title={label}
                    />,
                    <span
                      key={`${m.s.id}-label`}
                      className="mk-lbl"
                      style={labelStyle}
                      aria-hidden
                      data-testid="strip-label"
                    >
                      {m.s.name}
                    </span>,
                  ];
                }),
              )}
            </div>
          </div>
          <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
            <span />
            <div className="months relative h-[22px]">
              <span className="absolute left-0 font-semibold text-link">
                Today {formatShortDate(today, today)}
              </span>
              {stripMonths(today).map((m) => (
                <span key={m.label} className="absolute pl-1.5" style={{ left: `${m.left}%` }}>
                  <span className="max-[760px]:hidden">{m.label}</span>
                  <span className="hidden max-[760px]:inline" aria-hidden>
                    {m.label.slice(0, 3)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
        {marks.length ? (
          // Phones: the strip is unreadable at 375px, so the same links come as a list (B-35).
          <ul
            className="m-0 hidden list-none flex-col p-0 max-[760px]:flex"
            aria-label="Renewals and contract ends, soonest first"
          >
            {[...marks]
              .sort((x, y) => x.date.localeCompare(y.date))
              .map(({ s: sub, date }) => {
                const days = daysBetween(today, date);
                return (
                  <li key={sub.id} className="border-b border-line">
                    <Link
                      href={subHref(sub.id)}
                      replace
                      scroll={false}
                      className="flex items-baseline justify-between gap-3 py-2.5 hover:no-underline"
                      aria-current={sub.id === selected?.id ? "true" : undefined}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="rec truncate">{sub.name}</span>
                        <span className="cap">
                          {sub.kind === "contract" ? "Contract ends" : "Renews"}{" "}
                          {formatShortDate(date, today)}
                        </span>
                      </span>
                      <span className={`st c-${decisionTone(sub, today)} whitespace-nowrap`}>
                        {relativeDays(days)}
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        ) : null}
        {marks.length === 0 ? (
          <p className="m-0 text-[12px] text-ink3">
            No annual renewals or contract ends in the next {STRIP_DAYS} days.
          </p>
        ) : null}
      </section>

      <div className="toolbar">
        <ViewTabs
          label="Kind"
          tabs={KIND_FILTERS.map((k) => ({
            key: k.label,
            label: k.label,
            count: k.value
              ? matched.filter((s) => s.kind === k.value).length
              : filtered
                ? `${matched.length} of ${all.length}`
                : all.length,
            href: kindHref(k.value),
            current: kind === k.value,
          }))}
        />
        <span className="toolbar-tools">
          <ListFilter
            key={q}
            label="Filter subscriptions"
            placeholder="Name, vendor, plan or user"
            initial={q}
            resetParams={["sub"]}
          />
          <MissingToggle checked={onlyMissing} />
          {dueMonth ? (
            <Link
              href={kindHref(kind)}
              className="chip"
              aria-current="true"
              scroll={false}
              title="Show all renewal dates"
            >
              Due in {monthName} <span aria-hidden>×</span>
              <span className="sr-only">(clear this filter)</span>
            </Link>
          ) : null}
        </span>
      </div>

      <div className="split">
        <section className="list" aria-label="All subscriptions">
          {all.length === 0 ? (
            <EmptyState
              title="No subscriptions yet"
              actions={[{ label: "New subscription", href: "/subscriptions?new=1", primary: true }]}
            >
              Add your first recurring charge or contract.
            </EmptyState>
          ) : (
            <SubsTable
              rows={tableRows}
              selected={selected?.id ?? null}
              query={query.toString()}
              sort={sort}
            />
          )}
        </section>

        <DetailSheet
          param="sub"
          label={selected ? `${selected.name} detail` : "Subscription detail"}
        >
          {selected ? (
            <aside className="panel" aria-label={`${selected.name} detail`} key={selected.id}>
              <div className="panel-head">
                <div className="row1">
                  <span className="muted">
                    {KIND_LABEL[selected.kind]}
                    {selected.active ? "" : " · inactive"}
                  </span>
                  <div className="acts">
                    <EditSubscription
                      vendors={vendors}
                      today={today}
                      values={{
                        id: selected.id,
                        name: selected.name,
                        vendorName: selected.vendor,
                        kind: selected.kind,
                        plan: selected.plan,
                        seats: selected.seats,
                        billingCycle: selected.billingCycle,
                        costOriginal: selected.costOriginal,
                        currency: selected.currency,
                        paidBy: selected.paidBy,
                        userName: selected.userName,
                        project: selected.project,
                        nextChargeDate: selected.nextChargeDate,
                        contractEndDate: selected.contractEndDate,
                        autoRenew: selected.autoRenew,
                        active: selected.active,
                        tieredSeats: selected.tieredSeats,
                      }}
                    />
                  </div>
                </div>
                <h2 className="h2 lg">{selected.name}</h2>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  {selected.lastPaidDate && selected.lastPaidAed != null ? (
                    <>
                      <Aed value={selected.lastPaidAed} className="fig lg" />
                      <span className="muted">
                        last paid {formatShortDate(selected.lastPaidDate, today)}
                        {selectedPreset
                          ? ` · ${seatCountsLabel(selected.lastPaidStandard, selected.lastPaidPremium) ?? ""}`
                          : ""}
                      </span>
                    </>
                  ) : (
                    <span className="muted">No invoice yet</span>
                  )}
                </div>
              </div>

              <dl className="kv">
                <dt>Vendor</dt>
                <dd>{selected.vendor}</dd>
                {currentSeats ? (
                  <>
                    <dt>Seats</dt>
                    <dd>{tierSummary(currentSeats.standard, currentSeats.premium)}</dd>
                  </>
                ) : (
                  <>
                    <dt>Plan</dt>
                    <dd>
                      {[selected.plan, selected.seats ? `${selected.seats} seats` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </dd>
                  </>
                )}
                <dt>Expected cost</dt>
                <dd>
                  {selected.costAed != null ? (
                    <>
                      <Aed value={selected.costAed} />
                      <span className="muted ml-1.5 text-[12px]">
                        {selected.billingCycle === "monthly" ? "per month" : "per year"}
                        {usd(selected, baseCurrency)}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>Billing</dt>
                <dd>
                  {billingLabel(
                    selected.billingCycle,
                    selected.billingDay,
                    selected.nextChargeDate,
                  )}
                </dd>
                <dt>User</dt>
                <dd>{selected.userName ?? "—"}</dd>
                <dt>Project</dt>
                <dd>{selected.project ?? "—"}</dd>
                <dt>Paid by</dt>
                <dd>{selected.paidBy ?? "—"}</dd>
                <dt>Next charge</dt>
                <dd>
                  {selected.nextChargeDate ? (
                    <>
                      {formatDate(selected.nextChargeDate)}
                      <span className="muted ml-1.5 text-[12px]">
                        {relativeDays(daysBetween(today, selected.nextChargeDate))}
                      </span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
                <dt>{selected.kind === "contract" ? "Contract ends" : "Renews"}</dt>
                <dd>
                  {selected.kind === "contract"
                    ? selected.contractEndDate
                      ? formatDate(selected.contractEndDate)
                      : "—"
                    : selected.renewalDate
                      ? formatDate(selected.renewalDate)
                      : "Rolls monthly"}
                </dd>
                <dt>Auto-renew</dt>
                <dd>
                  <AutoRenewSwitch
                    key={selected.id}
                    id={selected.id}
                    name={selected.name}
                    checked={selected.autoRenew}
                  />
                </dd>
              </dl>

              <PanelTabs
                key={selected.id}
                seatCount={activeSeats}
                invoices={invoicesSection}
                seats={
                  <SeatsSection
                    key={selected.id}
                    subscriptionId={selected.id}
                    subscriptionName={selected.name}
                    seats={roster}
                    people={people}
                    today={today}
                  />
                }
              />
            </aside>
          ) : (
            <aside className="panel" aria-label="Subscription detail">
              <div className="empty">
                <b>Nothing selected</b>
                <span>Pick a subscription to see its invoices.</span>
              </div>
            </aside>
          )}
        </DetailSheet>
      </div>

      <NewSubscription open={one(params.new) === "1"} vendors={vendors} today={today} />
    </main>
  );
}
