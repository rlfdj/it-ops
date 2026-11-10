// Upload rules shared by the client (pre-checks) and server actions (enforcement).

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
];
export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic," + ALLOWED_UPLOAD_TYPES.join(",");

export type UploadRules = {
  maxBytes: number;
  types: string[];
  tooBig: string;
  wrongType: string;
};

const DOCUMENT_RULES: UploadRules = {
  maxBytes: MAX_UPLOAD_BYTES,
  types: ALLOWED_UPLOAD_TYPES,
  tooBig: "Files can be up to 25 MB.",
  wrongType: "Upload a PDF or an image (PNG, JPEG, WebP, HEIC).",
};

/**
 * Returns an error message, or null when the file is acceptable. Documents by default;
 * pass other rules for another kind of upload (the workspace logo).
 */
export function checkUpload(
  file: { size: number; type: string },
  rules: UploadRules = DOCUMENT_RULES,
): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > rules.maxBytes) return rules.tooBig;
  if (!rules.types.includes(file.type)) return rules.wrongType;
  return null;
}

/** Storage-safe file name, keeping the extension. */
export const safeFileName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(-120) || "document";

export type ActionResult<T = undefined> =
  ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };
