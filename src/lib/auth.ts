import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/allowed-email";
import { SESSION_HEADER } from "@/lib/session-header";

export type SessionUser = { email: string; id: string };

/**
 * The signed-in, allowed user for this request, or null. Uses the identity the proxy
 * already verified (SESSION_HEADER); falls back to verifying the JWT (getClaims) when the
 * proxy did not run.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const forwarded = (await headers()).get(SESSION_HEADER);
  if (forwarded === "-") return null;
  if (forwarded) {
    try {
      const user = JSON.parse(forwarded) as SessionUser;
      return isAllowedEmail(user.email) ? user : null;
    } catch {
      return null;
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims) return null;
  const email = typeof claims.email === "string" ? claims.email : null;
  if (!isAllowedEmail(email)) return null;
  return { email: email!.toLowerCase(), id: String(claims.sub) };
});

/**
 * Use at the top of every server action and protected page. Never trust the client:
 * the proxy already redirects, but this re-checks on the server for each call.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
