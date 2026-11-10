import { test } from "@playwright/test";
import { signIn } from "./sign-in";
import { seatRosterSteps } from "./seat-roster-steps";

/**
 * Focused test of the seat roster (import, add / edit / remove, past seats, pro-rated seats,
 * renewal pre-fill and mismatch note, offboarding item, search, activity). Uses an
 * "E2E Claude Code Team {STAMP}" subscription made directly in the database and removes it.
 * Run: BASE_URL=http://localhost:3100 pnpm test:e2e:focus seat-roster
 * Screenshots: set E2E_SHOT_DIR to a folder.
 */
test("subscriptions: seat roster", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await seatRosterSteps(page, (title, body) => test.step(title, body), `${Date.now()}`);
});
