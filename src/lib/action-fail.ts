import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { DomainError } from "./domain-error";

export const GENERIC_ERROR = "Couldn’t save. Try again.";

/**
 * Turns anything thrown by a server action into an `{ ok: false }` result. Domain and
 * validation messages are shown; everything else is logged (with its digest) and replaced
 * by a generic message. Next.js control-flow errors (redirects) are re-thrown.
 */
export function actionFail(error: unknown): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? "Check the highlighted fields." };
  }
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Server action failed", error);
  return { ok: false, error: GENERIC_ERROR };
}
