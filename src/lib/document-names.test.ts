import { describe, expect, it } from "vitest";
import {
  fileExtension,
  conventionalDocumentName,
  invoiceNumberPrefix,
  nameSegment,
  poDocumentStem,
  proratedSeatsLabel,
  proratedInvoiceStem,
  subscriptionInvoiceStem,
  uniqueDocumentName,
} from "./document-names";

describe("nameSegment", () => {
  it("keeps letters and digits, turns spaces into hyphens and drops symbols", () => {
    expect(nameSegment("e& Business Mobile")).toBe("e-Business-Mobile");
    expect(nameSegment("Dell Technologies LLC")).toBe("Dell-Technologies-LLC");
    expect(nameSegment("Redington (Gulf) FZE.")).toBe("Redington-Gulf-FZE");
    expect(nameSegment("Microsoft 365 Business Premium")).toBe("Microsoft-365-Business-Premium");
  });

  it("collapses repeated hyphens and trims them from the ends", () => {
    expect(nameSegment("  A  -  B  ")).toBe("A-B");
    expect(nameSegment("--Acme--Corp--")).toBe("Acme-Corp");
    expect(nameSegment("a_b/c")).toBe("abc");
  });

  it("trims to about 40 characters without a trailing hyphen", () => {
    const long = nameSegment("Adobe Creative Cloud for Teams and Enterprise Licences");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
    expect(long.startsWith("Adobe-Creative-Cloud-for-Teams")).toBe(true);
  });

  it("keeps non-Latin letters and falls back when nothing is left", () => {
    expect(nameSegment("شركة النور")).toBe("شركة-النور");
    expect(nameSegment("&&& ///")).toBe("Document");
  });
});

describe("document stems", () => {
  it("names a PO document Vendor_Type_Date", () => {
    expect(poDocumentStem("Dell Technologies", "invoice", "2026-10-14")).toBe(
      "Dell-Technologies_Invoice_2026-10-14",
    );
    expect(poDocumentStem("e& (Etisalat)", "delivery_note", "2026-01-02")).toBe(
      "e-Etisalat_Delivery-Note_2026-01-02",
    );
    expect(poDocumentStem("Mindware", "approval", "2026-10-14")).toBe(
      "Mindware_Approval_2026-10-14",
    );
  });

  it("adds the project to every type and the invoice number to the invoice only", () => {
    const d = "2026-10-14";
    const cases: [string | null, string | null, string, string][] = [
      ["INV-123", "Bidding", "invoice", "INV-123_Al-Ershad_Bidding_Invoice_2026-10-14"],
      [null, "Bidding", "invoice", "Al-Ershad_Bidding_Invoice_2026-10-14"],
      ["INV-123", null, "invoice", "INV-123_Al-Ershad_Invoice_2026-10-14"],
      [null, null, "invoice", "Al-Ershad_Invoice_2026-10-14"],
      ["INV-123", "Bidding", "delivery_note", "Al-Ershad_Bidding_Delivery-Note_2026-10-14"],
      [null, "Bidding", "delivery_note", "Al-Ershad_Bidding_Delivery-Note_2026-10-14"],
      ["INV-123", null, "delivery_note", "Al-Ershad_Delivery-Note_2026-10-14"],
      [null, null, "delivery_note", "Al-Ershad_Delivery-Note_2026-10-14"],
      ["INV-123", "Bidding", "approval", "Al-Ershad_Bidding_Approval_2026-10-14"],
      [null, "Bidding", "approval", "Al-Ershad_Bidding_Approval_2026-10-14"],
      ["INV-123", null, "approval", "Al-Ershad_Approval_2026-10-14"],
      [null, null, "approval", "Al-Ershad_Approval_2026-10-14"],
    ];
    for (const [number, project, kind, stem] of cases) {
      expect(poDocumentStem("Al-Ershad", kind as "invoice", d, project, number)).toBe(stem);
    }
    expect(poDocumentStem("Al-Ershad", "invoice", d, "  ", " ")).toBe(
      "Al-Ershad_Invoice_2026-10-14",
    );
    expect(poDocumentStem("Al-Ershad", "invoice", d, "Q4 / Fit-out", "INV #9")).toBe(
      "INV-9_Al-Ershad_Q4-Fit-out_Invoice_2026-10-14",
    );
  });

  it("names a subscription invoice by its billing period (year and month)", () => {
    expect(subscriptionInvoiceStem("e& Business Mobile", "2026-10-18")).toBe(
      "e-Business-Mobile_Subscription_Invoice_2026-10",
    );
  });

  it("adds the user, or the project when there is no user", () => {
    expect(subscriptionInvoiceStem("Claude Team", "2026-09-19", "Alex Morgan", "Bidding")).toBe(
      "Claude-Team_Subscription_Alex-Morgan_Invoice_2026-09",
    );
    expect(subscriptionInvoiceStem("ChatGPT Business", "2026-09-01", " ", "Bidding")).toBe(
      "ChatGPT-Business_Subscription_Bidding_Invoice_2026-09",
    );
    expect(subscriptionInvoiceStem("Claude Team", "2026-09-19", null, null)).toBe(
      "Claude-Team_Subscription_Invoice_2026-09",
    );
  });
});

describe("fileExtension", () => {
  it("keeps the original extension in lower case", () => {
    expect(fileExtension("Scan 0042.PDF")).toBe(".pdf");
    expect(fileExtension("photo.final.JPeG")).toBe(".jpeg");
  });
  it("falls back to the file type when the name has none", () => {
    expect(fileExtension("scan", "application/pdf")).toBe(".pdf");
    expect(fileExtension("scan", "image/jpeg")).toBe(".jpg");
    expect(fileExtension("scan")).toBe("");
  });
});

describe("uniqueDocumentName", () => {
  it("uses the plain name when it is free", () => {
    expect(uniqueDocumentName("Dell_Invoice_2026-10-14", ".pdf", ["other.pdf"])).toBe(
      "Dell_Invoice_2026-10-14.pdf",
    );
  });
  it("appends -2, -3 … when the name is taken (any case)", () => {
    const taken = ["Dell_Invoice_2026-10-14.pdf"];
    expect(uniqueDocumentName("Dell_Invoice_2026-10-14", ".pdf", taken)).toBe(
      "Dell_Invoice_2026-10-14-2.pdf",
    );
    taken.push("dell_invoice_2026-10-14-2.PDF");
    expect(uniqueDocumentName("Dell_Invoice_2026-10-14", ".pdf", taken)).toBe(
      "Dell_Invoice_2026-10-14-3.pdf",
    );
  });
  it("a different extension is a different name", () => {
    expect(uniqueDocumentName("A_Invoice_2026-10-14", ".png", ["A_Invoice_2026-10-14.pdf"])).toBe(
      "A_Invoice_2026-10-14.png",
    );
  });
});

describe("proratedInvoiceStem", () => {
  it("uses the row's user, else its project, with the full charge date", () => {
    expect(proratedInvoiceStem("ChatGPT Business", "2026-10-14", "Sara Khan", "Atlas")).toBe(
      "ChatGPT-Business_Subscription_Sara-Khan_Pro-rated_Invoice_2026-10-14",
    );
    expect(proratedInvoiceStem("ChatGPT Business", "2026-10-14", "", "Atlas")).toBe(
      "ChatGPT-Business_Subscription_Atlas_Pro-rated_Invoice_2026-10-14",
    );
    expect(proratedInvoiceStem("ChatGPT Business", "2026-10-14")).toBe(
      "ChatGPT-Business_Subscription_Pro-rated_Invoice_2026-10-14",
    );
  });
});

describe("invoiceNumberPrefix", () => {
  it("leads the name with the typed invoice number, or adds nothing", () => {
    expect(invoiceNumberPrefix("OAI-2610-1481")).toBe("OAI-2610-1481_");
    expect(invoiceNumberPrefix("Inv 7/2026")).toBe("Inv-72026_");
    expect(invoiceNumberPrefix("  ")).toBe("");
    expect(invoiceNumberPrefix(null)).toBe("");
  });
});

describe("conventionalDocumentName", () => {
  const sub = {
    owner: "subscription_invoice" as const,
    subscriptionName: "ChatGPT Business",
    userName: "Test",
    project: null,
    originalName: "Scan.PDF",
    storedName: "old.pdf",
  };
  it("renewal invoices use the subscription's current user", () => {
    expect(
      conventionalDocumentName({
        ...sub,
        invoice: { kind: "renewal", periodStart: "2026-08-19", userName: null, project: null },
      }),
    ).toBe("ChatGPT-Business_Subscription_Test_Invoice_2026-08.pdf");
  });
  it("pro-rated invoices use their own user, not the subscription's", () => {
    expect(
      conventionalDocumentName({
        ...sub,
        invoice: { kind: "prorated", periodStart: "2026-10-14", userName: "Sara", project: null },
      }),
    ).toBe("ChatGPT-Business_Subscription_Sara_Pro-rated_Invoice_2026-10-14.pdf");
  });
  it("PO documents are Vendor_Type_Date.ext; unknown kinds keep the stored name", () => {
    const po = {
      owner: "purchase_order" as const,
      vendor: "Dell Technologies",
      attachedOn: "2026-10-14",
      originalName: null,
      storedName: "x.PDF",
    };
    expect(conventionalDocumentName({ ...po, kind: "delivery_note" })).toBe(
      "Dell-Technologies_Delivery-Note_2026-10-14.pdf",
    );
    expect(conventionalDocumentName({ ...po, kind: "other" })).toBe("x.PDF");
    // With an invoice date, all three files use it; without one, the attach date.
    const dated = { ...po, invoiceDate: "2026-09-30" };
    for (const [kind, label] of [
      ["invoice", "Invoice"],
      ["delivery_note", "Delivery-Note"],
      ["approval", "Approval"],
    ] as const)
      expect(conventionalDocumentName({ ...dated, kind })).toBe(
        `Dell-Technologies_${label}_2026-09-30.pdf`,
      );
    expect(conventionalDocumentName({ ...po, invoiceDate: null, kind: "approval" })).toBe(
      "Dell-Technologies_Approval_2026-10-14.pdf",
    );
    const tagged = { ...po, project: "Bidding", invoiceNumber: "INV-123" };
    expect(conventionalDocumentName({ ...tagged, kind: "invoice" })).toBe(
      "INV-123_Dell-Technologies_Bidding_Invoice_2026-10-14.pdf",
    );
    expect(conventionalDocumentName({ ...tagged, kind: "approval" })).toBe(
      "Dell-Technologies_Bidding_Approval_2026-10-14.pdf",
    );
  });
});

describe("proratedSeatsLabel (pro-rated file names)", () => {
  it("is the person for one seat, even when it has a project", () => {
    expect(proratedSeatsLabel([{ personName: "Sara Pro", project: "Bidding" }])).toBe("Sara Pro");
  });
  it("is the shared project when every seat has the same one", () => {
    expect(
      proratedSeatsLabel([
        { personName: "A", project: "Bidding" },
        { personName: "B", project: "bidding" },
      ]),
    ).toBe("Bidding");
  });
  it("is Multiple when the projects differ or are missing", () => {
    expect(
      proratedSeatsLabel([
        { personName: "A", project: "Bidding" },
        { personName: "B", project: "Ops" },
      ]),
    ).toBe("Multiple");
    expect(proratedSeatsLabel([{ personName: "A" }, { personName: "B" }])).toBe("Multiple");
    expect(
      proratedSeatsLabel([
        { personName: "A", project: "Bidding" },
        { personName: "B", project: null },
      ]),
    ).toBe("Multiple");
  });
  it("is null without seats", () => {
    expect(proratedSeatsLabel([])).toBeNull();
    expect(proratedSeatsLabel(undefined)).toBeNull();
  });

  const src = {
    owner: "subscription_invoice" as const,
    subscriptionName: "Claude Code Team",
    invoiceNumber: null,
    userName: "Someone Else",
    project: "Other",
    originalName: "scan.pdf",
    storedName: "x.pdf",
  };
  const invoice = {
    kind: "prorated" as const,
    periodStart: "2026-10-14",
    userName: null,
    project: null,
  };
  it("names the file from the seats; old rows keep their own user and project", () => {
    expect(
      conventionalDocumentName({
        ...src,
        invoice: { ...invoice, seats: [{ personName: "Sara Pro", project: "Bidding" }] },
      }),
    ).toBe("Claude-Code-Team_Subscription_Sara-Pro_Pro-rated_Invoice_2026-10-14.pdf");
    expect(
      conventionalDocumentName({
        ...src,
        invoice: {
          ...invoice,
          seats: [
            { personName: "A", project: "X" },
            { personName: "B", project: "Y" },
          ],
        },
      }),
    ).toBe("Claude-Code-Team_Subscription_Multiple_Pro-rated_Invoice_2026-10-14.pdf");
    expect(
      conventionalDocumentName({
        ...src,
        invoice: { ...invoice, userName: "Old User", project: "Old Project" },
      }),
    ).toBe("Claude-Code-Team_Subscription_Old-User_Pro-rated_Invoice_2026-10-14.pdf");
  });
});
