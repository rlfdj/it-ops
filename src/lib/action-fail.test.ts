import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("next/navigation", () => ({
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  },
}));

import { actionFail, GENERIC_ERROR } from "./action-fail";
import { DomainError } from "./domain-error";

describe("actionFail", () => {
  it("passes domain messages through", () => {
    expect(actionFail(new DomainError("Tag X is already in stock."))).toEqual({
      ok: false,
      error: "Tag X is already in stock.",
    });
  });

  it("shows the first validation message", () => {
    const parsed = z.object({ a: z.string().min(1, "Give it a name.") }).safeParse({ a: "" });
    expect(actionFail(parsed.error)).toEqual({ ok: false, error: "Give it a name." });
  });

  it("hides raw errors behind a generic message and logs them", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = actionFail(new Error('duplicate key value violates unique constraint "x"'));
    expect(result).toEqual({ ok: false, error: GENERIC_ERROR });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("re-throws Next.js control-flow errors", () => {
    expect(() => actionFail(new Error("NEXT_REDIRECT"))).toThrow("NEXT_REDIRECT");
  });
});
