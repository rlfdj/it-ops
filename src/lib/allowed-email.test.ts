import { describe, expect, it } from "vitest";
import { isAllowedEmail } from "./allowed-email";

describe("isAllowedEmail", () => {
  const allowed = "alex@example.com";

  it("accepts the configured address, ignoring case and spaces", () => {
    expect(isAllowedEmail("alex@example.com", allowed)).toBe(true);
    expect(isAllowedEmail("  Alex@EXAMPLE.com ", allowed)).toBe(true);
  });

  it("rejects every other address", () => {
    expect(isAllowedEmail("someone@example.com", allowed)).toBe(false);
    expect(isAllowedEmail("alex@example.com.evil.test", allowed)).toBe(false);
  });

  it("fails closed when nothing is configured or no email is given", () => {
    expect(isAllowedEmail("alex@example.com", undefined)).toBe(false);
    expect(isAllowedEmail("alex@example.com", "")).toBe(false);
    expect(isAllowedEmail(null, allowed)).toBe(false);
  });
});
