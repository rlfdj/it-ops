import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { formatDate, todayIn } from "@/lib/dates";
import { getWorkspaceSettings } from "@/lib/queries/settings";
import { logoUrl } from "@/lib/workspace";
import { KIND_LABEL } from "@/lib/checklists";
import { getDb } from "@/db";
import { stockItems } from "@/db/schema";
import { getChecklistItems, listChecklists } from "@/lib/queries/checklists";
import { ItOpsLogo } from "@/components/shell/logo";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Handover form" };

export default async function HandoverPage({ params }: PageProps<"/handover/[id]">) {
  await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const settings = await getWorkspaceSettings();
  const today = todayIn(settings.timeZone);
  const logoSrc = logoUrl(settings.logoPath);
  const brandName = settings.workspaceName;
  const checklist = (await listChecklists(today)).find((c) => c.id === id.data);
  if (!checklist) notFound();
  const items = await getChecklistItems(checklist.id);
  const equipment = items.filter((i) => i.section === "assets");
  const pieces = equipment
    .flatMap((e) => (e.children.length ? e.children : [e]))
    .filter((i) => !i.notApplicable);
  // A tag or serial is printed only when it is a real stock unit named on the item.
  const stock = await getDb()
    .select({ tag: stockItems.tag, serial: stockItems.serialNumber })
    .from(stockItems);
  const knownUnit = (p: { label: string; detail: string | null }) => {
    const text = `${p.label} ${p.detail ?? ""}`.toLowerCase();
    return stock.find((u) => text.includes(u.tag.toLowerCase()));
  };
  const accounts = items.filter((i) => i.section !== "assets" && !i.notApplicable);
  const offboarding = checklist.kind === "offboarding";

  return (
    <main className="mx-auto flex max-w-[760px] flex-col gap-7 px-6 py-10 print:px-0 print:py-0">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- the uploaded logo, served by /brand/logo
            <img
              src={logoSrc}
              alt=""
              style={{
                height: 22,
                width: "auto",
                maxWidth: 180,
                background: "var(--bar)",
                padding: "6px 10px",
                borderRadius: 6,
                boxSizing: "content-box",
                printColorAdjust: "exact",
              }}
            />
          ) : (
            <ItOpsLogo height={22} />
          )}
          <span className="text-ink2 text-[12px]">{brandName}</span>
        </div>
        <PrintButton />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{KIND_LABEL[checklist.kind]} · equipment handover</span>
        <h1 className="h1">{checklist.person.name}</h1>
        <span className="text-ink3 text-[12px]">
          Equipment handover form · Ref {checklist.id.slice(0, 8).toUpperCase()} · Generated{" "}
          {formatDate(today)}
        </span>
        <span className="text-ink2">
          {[
            checklist.person.department,
            `${offboarding ? "Last day" : "Start date"} ${formatDate(checklist.targetDate)}`,
            checklist.person.managerName ? `Manager ${checklist.person.managerName}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <span className="eyebrow">{offboarding ? "Equipment returned" : "Equipment issued"}</span>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line2 text-[10.5px] tracking-[0.07em] text-ink3 uppercase">
              <th className="py-2 pr-3 font-semibold">Item</th>
              <th className="w-[34%] py-2 pr-3 font-semibold">Serial / tag</th>
              <th className="w-[96px] py-2 text-center font-semibold">
                {offboarding ? "Returned" : "Received"}
              </th>
            </tr>
          </thead>
          <tbody>
            {pieces.length ? (
              pieces.map((p) => (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-3 pr-3">
                    <span className="font-medium">{p.label}</span>
                    {p.detail ? <span className="muted block text-[12px]">{p.detail}</span> : null}
                  </td>
                  <td className="py-3 pr-3">
                    {(() => {
                      const unit = knownUnit(p);
                      return unit ? (
                        <span className="font-mono text-[12.5px]">
                          {unit.tag}
                          {unit.serial ? <span className="block">S/N {unit.serial}</span> : null}
                        </span>
                      ) : (
                        <div className="write-in" />
                      );
                    })()}
                  </td>
                  <td className="py-3 text-center">
                    <span className="tick" aria-hidden />
                    <span className="sr-only">{p.doneAt ? "Yes" : "No"}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="py-3 text-ink3">
                  No equipment listed.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {accounts.length ? (
        <section className="flex flex-col gap-2">
          <span className="eyebrow">{offboarding ? "Access removal" : "Accounts set up"}</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {accounts.map((a) => (
              <li key={a.id} className="flex justify-between gap-4 border-b border-line py-1.5">
                <span>{a.label}</span>
                <span className="inline-flex items-center gap-2 text-ink3">
                  <span className="tick" aria-hidden>
                    {a.doneAt ? "✓" : null}
                  </span>
                  {a.doneAt ? "Done" : "Open"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-10 pt-6">
        {[offboarding ? "Returned by (employee)" : "Received by (employee)", "IT"].map((who) => (
          <div key={who} className="flex flex-col gap-8">
            <span className="eyebrow">{who}</span>
            <span className="border-b border-ink2 pb-1 text-[12px] text-ink3">Signature</span>
            <span className="border-b border-ink2 pb-1 text-[12px] text-ink3">Handover date</span>
          </div>
        ))}
      </section>

      <footer className="border-t border-line pt-3 text-[11px] text-ink3">
        {brandName} equipment handover · {checklist.person.name} · Ref{" "}
        {checklist.id.slice(0, 8).toUpperCase()} · Generated {formatDate(today)}
      </footer>
    </main>
  );
}
