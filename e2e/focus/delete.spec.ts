import { test } from "@playwright/test";
import { signIn } from "./sign-in";
import { deleteSteps } from "./delete-steps";

/**
 * Focused test of Delete: subscription (with invoices and files), ledger periods, one
 * attached file, purchase, stock item and checklist. Creates its own E2E records and removes
 * them. Run: BASE_URL=http://localhost:3100 pnpm test:e2e:focus delete
 */
test("delete: records, ledger periods and attached files", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await deleteSteps(page, (title, body) => test.step(title, body), `${Date.now()}`);
});
