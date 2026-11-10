// Procurement business rules. Pure functions (no I/O) so they are easy to unit-test.

export const PO_STAGES = ["requested", "approved", "ordered", "delivered", "closed"] as const;
export type PoStage = (typeof PO_STAGES)[number];

export const PO_DOC_KINDS = ["invoice", "delivery_note", "approval"] as const;
export type PoDocKind = (typeof PO_DOC_KINDS)[number];

export const STAGE_LABEL: Record<PoStage, string> = {
  requested: "Requested",
  approved: "Approved",
  ordered: "Ordered",
  delivered: "Delivered",
  closed: "Closed",
};

/** Status dot colour per stage (design: Procurement.html). */
export const STAGE_TONE: Record<PoStage, "grey" | "blue" | "amber" | "green"> = {
  requested: "grey",
  approved: "blue",
  ordered: "amber",
  delivered: "green",
  closed: "grey",
};

/**
 * Owner rule: a purchase can only be closed once all three documents are attached, in the
 * order they arrive: approval, invoice, delivery note.
 */
export const CLOSE_REQUIRES: readonly PoDocKind[] = ["approval", "invoice", "delivery_note"];

/** The documents still missing before this purchase can be closed (empty when it can). */
export function missingToClose(attachedKinds: Iterable<string>): PoDocKind[] {
  const have = new Set(attachedKinds);
  return CLOSE_REQUIRES.filter((k) => !have.has(k));
}

/** "the invoice and delivery note" — for messages about missing close documents. */
export function docList(kinds: readonly PoDocKind[]): string {
  const names = kinds.map((k) => DOC_LABEL[k].toLowerCase());
  if (names.length <= 1) return `the ${names[0] ?? ""}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const DOC_LABEL: Record<PoDocKind, string> = {
  invoice: "Invoice",
  delivery_note: "Delivery note",
  approval: "Approval",
};

export const DOC_SHORT: Record<PoDocKind, string> = {
  invoice: "INV",
  delivery_note: "DN",
  approval: "APR",
};

/** The stage from which each document is required (business rule 2). */
export const DOC_REQUIRED_FROM: Record<PoDocKind, PoStage> = {
  approval: "requested",
  invoice: "ordered",
  delivery_note: "delivered",
};

export const stageIndex = (stage: PoStage) => PO_STAGES.indexOf(stage);

export type DocState = "ok" | "miss" | "na";

/**
 * A document counts as missing only once the PO has reached the stage that needs it.
 * Before that it is "not needed yet".
 */
export function docState(stage: PoStage, kind: PoDocKind, attached: boolean): DocState {
  if (attached) return "ok";
  return stageIndex(stage) >= stageIndex(DOC_REQUIRED_FROM[kind]) ? "miss" : "na";
}

/** Document states for a PO in display order (invoice, delivery note, approval). */
export function docStates(stage: PoStage, attachedKinds: Iterable<string>) {
  const attached = new Set(attachedKinds);
  return PO_DOC_KINDS.map((kind) => ({ kind, state: docState(stage, kind, attached.has(kind)) }));
}

export function missingDocKinds(stage: PoStage, attachedKinds: Iterable<string>): PoDocKind[] {
  return docStates(stage, attachedKinds)
    .filter((d) => d.state === "miss")
    .map((d) => d.kind);
}

/**
 * Business rule 1: attaching an approval file to a PO that is still `requested`
 * moves it to `approved`. Returns the new stage, or null if nothing changes.
 */
export function stageAfterAttaching(stage: PoStage, kind: string): PoStage | null {
  return stage === "requested" && kind === "approval" ? "approved" : null;
}

/**
 * The next stage a PO can be moved to by hand. `requested → approved` happens only by
 * attaching the approval file, so it has no manual step.
 */
export function nextManualStage(stage: PoStage): PoStage | null {
  switch (stage) {
    case "approved":
      return "ordered";
    case "ordered":
      return "delivered";
    case "delivered":
      return "closed";
    default:
      return null;
  }
}

export const ADVANCE_LABEL: Partial<Record<PoStage, string>> = {
  ordered: "Mark as ordered",
  delivered: "Mark as delivered",
  closed: "Close purchase",
};

export const lineTotal = (line: { qty: number; unitPriceAed: number }) =>
  Math.round(line.qty * line.unitPriceAed * 100) / 100;

/** VAT rate applied to a purchase when its VAT box is ticked. */
export const VAT_RATE = 0.05;

export type PoTotal = {
  subtotal: number;
  discount: number;
  /** Subtotal less the discount (never below zero): the amount VAT is charged on. */
  net: number;
  vat: number;
  total: number;
};

/**
 * A purchase's money: the discount comes off the line subtotal first, then 5% VAT (when
 * ticked) is added on what is left. Works in whole cents so rounding is half-up and exact.
 */
export function poTotal(input: {
  subtotal: number;
  discount?: number | null;
  vat?: boolean;
}): PoTotal {
  const subtotalC = Math.round(input.subtotal * 100);
  const discountC = Math.max(0, Math.round((input.discount ?? 0) * 100));
  const netC = Math.max(0, subtotalC - discountC);
  const vatC = input.vat ? Math.floor((netC * 5 + 50) / 100) : 0;
  return {
    subtotal: subtotalC / 100,
    discount: Math.min(discountC, subtotalC) / 100,
    net: netC / 100,
    vat: vatC / 100,
    total: (netC + vatC) / 100,
  };
}

/** "2× iPad Air 11″ M3, 4× Synology HAT5300 8 TB drive" (text before the first comma). */
export function lineSummary(lines: { qty: number; description: string }[]): string {
  return lines.map((l) => `${l.qty}× ${l.description.split(",")[0]!.trim()}`).join(", ");
}
