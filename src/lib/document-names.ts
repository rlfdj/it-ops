// Names for newly uploaded documents: `Vendor_Type_Date.ext`. Pure functions.
//   PO documents          Dell-Technologies_Invoice_2026-10-14.pdf
//   Subscription invoices e-Business-Mobile_Subscription_Invoice_2026-10.pdf
// Download names are computed from current data when a file is downloaded.
// The file the user picked keeps its own name in `documents.original_name`.

export type NamedDocKind = "approval" | "delivery_note" | "invoice";

/** The document type as it appears in a file name. */
export const DOC_TYPE_NAME: Record<NamedDocKind, string> = {
  approval: "Approval",
  delivery_note: "Delivery-Note",
  invoice: "Invoice",
};

const MAX_SEGMENT = 40;

/**
 * A vendor or subscription name as a file-name segment: letters and digits stay, spaces
 * become hyphens, other symbols are dropped, repeated hyphens collapse, trimmed to ~40.
 * "e& Business Mobile" becomes "e-Business-Mobile".
 */
export function nameSegment(text: string, max = MAX_SEGMENT): string {
  const cleaned = text
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, max).replace(/-+$/g, "") || "Document";
}

/**
 * `[InvoiceNumber_]Vendor_[Project_]Type_Date` for a purchase-order document. The invoice
 * number is used for the invoice only; the project for every type. `date` is the attach
 * date in the workspace time zone.
 */
export function poDocumentStem(
  vendor: string,
  kind: NamedDocKind,
  date: string,
  project?: string | null,
  invoiceNumber?: string | null,
): string {
  const number = kind === "invoice" ? invoiceNumberPrefix(invoiceNumber) : "";
  const proj = project?.trim() ? `${nameSegment(project)}_` : "";
  return `${number}${nameSegment(vendor)}_${proj}${DOC_TYPE_NAME[kind]}_${date}`;
}

/** The user, else the project, else nothing: the `[User or Project]` part of an invoice name. */
function whoSegment(userName?: string | null, project?: string | null): string {
  const label = userName?.trim() || project?.trim();
  return label ? `${nameSegment(label)}_` : "";
}

/**
 * The name part of a pro-rated invoice that lists seats: the person for one seat; the
 * project when every seat shares one; otherwise "Multiple". Null without seats.
 */
export function proratedSeatsLabel(
  seats: { personName: string; project?: string | null }[] | null | undefined,
): string | null {
  if (!seats?.length) return null;
  if (seats.length === 1) return seats[0]!.personName.trim() || "Multiple";
  const projects = seats.map((s) => s.project?.trim() ?? "");
  if (projects[0] && projects.every((p) => p.toLowerCase() === projects[0]!.toLowerCase()))
    return projects[0];
  return "Multiple";
}

/**
 * `Name_Subscription_[User or Project]_Invoice_YYYY-MM` for a renewal invoice, from its
 * billing period. Uses the project when there is no user, and neither when both are blank.
 */
export function subscriptionInvoiceStem(
  subscriptionName: string,
  periodStart: string,
  userName?: string | null,
  project?: string | null,
): string {
  return `${nameSegment(subscriptionName)}_Subscription_${whoSegment(userName, project)}Invoice_${periodStart.slice(0, 7)}`;
}

/**
 * `Name_Subscription_[User or Project]_Pro-rated_Invoice_YYYY-MM-DD` for a pro-rated
 * invoice, from the charge date and the row's own user/project.
 */
export function proratedInvoiceStem(
  subscriptionName: string,
  chargeDate: string,
  userName?: string | null,
  project?: string | null,
): string {
  return `${nameSegment(subscriptionName)}_Subscription_${whoSegment(userName, project)}Pro-rated_Invoice_${chargeDate.slice(0, 10)}`;
}

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

/** The extension to keep (lower case, with the dot), from the original name else the type. */
export function fileExtension(originalName: string, mimeType?: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(originalName.trim());
  if (match) return `.${match[1]!.toLowerCase()}`;
  return (mimeType && EXT_BY_MIME[mimeType]) || "";
}

/**
 * `stem.ext`, or `stem-2.ext`, `stem-3.ext`, … when another document already has that name
 * (compared without regard to case). `taken` is the file names already in use.
 */
export function uniqueDocumentName(stem: string, ext: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  let name = `${stem}${ext}`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}${ext}`;
  return name;
}

/** What a document's conventional name is computed from, read from current data. */
export type NameSource =
  | {
      owner: "purchase_order";
      kind: string;
      vendor: string;
      /** The purchase's optional project and invoice number. */
      project?: string | null;
      invoiceNumber?: string | null;
      /** The purchase's invoice date: when set, all three files use it as their date. */
      invoiceDate?: string | null;
      /** The attach date in the workspace time zone (`YYYY-MM-DD`). */
      attachedOn: string;
      originalName: string | null;
      storedName: string;
    }
  | {
      owner: "subscription_invoice";
      subscriptionName: string;
      /** The invoice number typed for this period, if any: it leads the name. */
      invoiceNumber?: string | null;
      /** The subscription's current user and project. */
      userName: string | null;
      project: string | null;
      invoice: {
        kind: "renewal" | "prorated";
        periodStart: string;
        /** The pro-rated row's own user and project (rows from before the seat list). */
        userName: string | null;
        project: string | null;
        /** The seats a pro-rated invoice lists; they win over the row's own user and project. */
        seats?: { personName: string; project?: string | null }[];
      };
      originalName: string | null;
      storedName: string;
    };

/**
 * The conventional file name for a document, computed from current data (so a changed
 * subscription user shows up in old documents too). Falls back to the stored name for
 * documents that don't follow the convention (kind "other").
 */
export function conventionalDocumentName(src: NameSource): string {
  const ext = fileExtension(src.originalName ?? src.storedName);
  if (src.owner === "purchase_order") {
    if (!(src.kind in DOC_TYPE_NAME)) return src.storedName;
    return `${poDocumentStem(
      src.vendor,
      src.kind as NamedDocKind,
      src.invoiceDate || src.attachedOn,
      src.project,
      src.invoiceNumber,
    )}${ext}`;
  }
  const { invoice } = src;
  const seatsLabel = invoice.kind === "prorated" ? proratedSeatsLabel(invoice.seats) : null;
  const stem =
    invoice.kind === "prorated"
      ? proratedInvoiceStem(
          src.subscriptionName,
          invoice.periodStart,
          seatsLabel ?? invoice.userName,
          seatsLabel ? null : invoice.project,
        )
      : subscriptionInvoiceStem(
          src.subscriptionName,
          invoice.periodStart,
          src.userName,
          src.project,
        );
  return `${invoiceNumberPrefix(src.invoiceNumber)}${stem}${ext}`;
}

/** `INV-1042_` when an invoice number was typed, else nothing (the convention alone). */
export function invoiceNumberPrefix(invoiceNumber?: string | null): string {
  const n = invoiceNumber?.trim() ? nameSegment(invoiceNumber) : "";
  return n ? `${n}_` : "";
}
