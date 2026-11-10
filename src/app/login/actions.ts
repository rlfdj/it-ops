"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/allowed-email";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string; sentAt: number }
  | { status: "error"; message: string; email?: string };

/** Seconds a person must wait before another link goes to the same address. */
const RESEND_SECONDS = 60;

// Best effort per server instance; Supabase enforces its own per-address limit (429 below).
const lastSent = new Map<string, number>();

const schema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  next: z.string().startsWith("/").optional().catch(undefined),
});

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
      email: String(formData.get("email") ?? ""),
    };
  }
  const { email, next } = parsed.data;

  if (!isAllowedEmail(email)) {
    return { status: "error", message: "This address can’t sign in to IT Ops.", email };
  }

  const key = email.toLowerCase();
  const wait = RESEND_SECONDS * 1000 - (Date.now() - (lastSent.get(key) ?? 0));
  if (wait > 0) {
    return {
      status: "error",
      email,
      message: `A link was just sent. Wait ${Math.ceil(wait / 1000)} seconds before asking for another.`,
    };
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const callback = new URL("/auth/callback", `${proto}://${host}`);
  if (next && next !== "/") callback.searchParams.set("next", next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
  });
  if (error) {
    return {
      status: "error",
      email,
      message:
        error.status === 429
          ? "Too many sign-in emails were sent. Wait a few minutes and try again."
          : `Couldn’t send the link: ${error.message}`,
    };
  }
  lastSent.set(key, Date.now());
  if (lastSent.size > 200) {
    for (const [k, at] of lastSent) if (Date.now() - at > RESEND_SECONDS * 1000) lastSent.delete(k);
  }
  return { status: "sent", email, sentAt: Date.now() };
}
