// Workspace settings shared by the server and the client. Pure: no I/O.

export const DEFAULT_CURRENCY = "AED";
export const DEFAULT_TIME_ZONE = "Asia/Dubai";
export const DEFAULT_WORKSPACE_NAME = "IT Ops";
export const DEFAULT_USD_RATE = 3.6725;

/** Base currencies offered in Settings. Every one uses two decimals. */
export const BASE_CURRENCIES = [
  { code: "AED", name: "UAE dirham" },
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "Pound sterling" },
  { code: "SAR", name: "Saudi riyal" },
] as const;

export const isBaseCurrency = (code: string) => BASE_CURRENCIES.some((c) => c.code === code);

export type WorkspaceSettings = {
  workspaceName: string;
  /** Base-currency units per 1 USD (column `usd_aed_rate`). */
  usdAedRate: number;
  baseCurrency: string;
  timeZone: string;
  /** Storage path of the custom logo, or null for the default mark. */
  logoPath: string | null;
};

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  workspaceName: DEFAULT_WORKSPACE_NAME,
  usdAedRate: DEFAULT_USD_RATE,
  baseCurrency: DEFAULT_CURRENCY,
  timeZone: DEFAULT_TIME_ZONE,
  logoPath: null,
};

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones for the Settings select (UTC first, since ICU leaves it out of the list). */
export function timeZoneOptions(): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return Array.from(new Set(["UTC", DEFAULT_TIME_ZONE, ...all])).sort((a, b) => a.localeCompare(b));
}

// Logo upload rules (client pre-check and server enforcement).
export const MAX_LOGO_BYTES = 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/svg+xml", "image/jpeg"];
export const LOGO_RULES = {
  maxBytes: MAX_LOGO_BYTES,
  types: LOGO_TYPES,
  tooBig: "The logo can be up to 1 MB.",
  wrongType: "Upload a PNG, SVG or JPG logo.",
};
export const LOGO_ACCEPT = ".png,.svg,.jpg,.jpeg," + LOGO_TYPES.join(",");

/** Public URL the app and the login page load the logo from; changes with every upload. */
export function logoUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  return `/brand/logo?v=${encodeURIComponent(logoPath.split("/").pop() ?? "")}`;
}
