/** Normalises an email for comparison. */
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * True when `email` equals the configured ALLOWED_EMAIL. With no ALLOWED_EMAIL
 * configured, nobody is allowed (fail closed).
 */
export function isAllowedEmail(
  email: string | null | undefined,
  allowed: string | undefined = process.env.ALLOWED_EMAIL,
): boolean {
  if (!email || !allowed) return false;
  return normaliseEmail(email) === normaliseEmail(allowed);
}
