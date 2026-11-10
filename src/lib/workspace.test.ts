import { describe, expect, it } from "vitest";
import { checkUpload } from "./uploads";
import {
  BASE_CURRENCIES,
  DEFAULT_SETTINGS,
  isBaseCurrency,
  isValidTimeZone,
  LOGO_RULES,
  logoUrl,
  MAX_LOGO_BYTES,
  timeZoneOptions,
} from "./workspace";

describe("workspace defaults", () => {
  it("keep AED, Dubai and the 3.6725 rate", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      workspaceName: "IT Ops",
      baseCurrency: "AED",
      timeZone: "Asia/Dubai",
      usdAedRate: 3.6725,
      logoPath: null,
    });
  });

  it("offers a short currency list with AED first", () => {
    expect(BASE_CURRENCIES.map((c) => c.code)).toEqual(["AED", "USD", "EUR", "GBP", "SAR"]);
    expect(isBaseCurrency("EUR")).toBe(true);
    expect(isBaseCurrency("XYZ")).toBe(false);
  });
});

describe("time zones", () => {
  it("accepts IANA names only", () => {
    expect(isValidTimeZone("Asia/Dubai")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Dubai")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("lists zones with Dubai and UTC included, sorted, without repeats", () => {
    const zones = timeZoneOptions();
    expect(zones).toContain("Asia/Dubai");
    expect(zones).toContain("UTC");
    expect(zones).toContain("Asia/Manila");
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe("logo", () => {
  const ok = { size: 1000, type: "image/png" };

  it("accepts PNG, SVG and JPG up to 1 MB", () => {
    expect(checkUpload(ok, LOGO_RULES)).toBeNull();
    expect(checkUpload({ size: 10, type: "image/svg+xml" }, LOGO_RULES)).toBeNull();
    expect(checkUpload({ size: MAX_LOGO_BYTES, type: "image/jpeg" }, LOGO_RULES)).toBeNull();
  });

  it("refuses other types, empty files and files over 1 MB", () => {
    expect(checkUpload({ size: 10, type: "application/pdf" }, LOGO_RULES)).toBe(
      "Upload a PNG, SVG or JPG logo.",
    );
    expect(checkUpload({ size: 10, type: "image/webp" }, LOGO_RULES)).not.toBeNull();
    expect(checkUpload({ size: 0, type: "image/png" }, LOGO_RULES)).toBe("That file is empty.");
    expect(checkUpload({ size: MAX_LOGO_BYTES + 1, type: "image/png" }, LOGO_RULES)).toBe(
      "The logo can be up to 1 MB.",
    );
  });

  it("keeps the document rules for documents", () => {
    expect(checkUpload({ size: 10, type: "image/svg+xml" })).not.toBeNull();
    expect(checkUpload({ size: 10, type: "application/pdf" })).toBeNull();
  });

  it("links to the logo route with a version that changes per upload", () => {
    expect(logoUrl(null)).toBeNull();
    expect(logoUrl("branding/logo-ab12cd34.png")).toBe("/brand/logo?v=logo-ab12cd34.png");
  });
});
