import { test } from "@playwright/test";
import { signIn } from "./sign-in";
import { poTotalsSteps } from "./po-totals-steps";

/**
 * Focused test of purchase discount, 5% VAT and invoice-date file names. Creates one E2E
 * purchase and removes it (and its file) by its exact E2E vendor.
 * Run: BASE_URL=http://localhost:3010 pnpm test:e2e:focus po-totals
 */
test("procurement: discount, VAT and invoice date", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await poTotalsSteps(page, (title, body) => test.step(title, body), `${Date.now()}`);
});
