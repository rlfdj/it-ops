import { test } from "@playwright/test";
import { signIn } from "./sign-in";
import { boardSteps } from "./board-steps";

/**
 * Focused test of the Board: sticky notes, drag/resize at 80% zoom, attachments, Make task,
 * delete with Undo, and the phone list. Creates its own data and removes it.
 * Run: BASE_URL=http://localhost:3500 pnpm test:e2e:focus board
 */
test("board: notes, drag, resize, files, make task, delete", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page);
  await boardSteps(page, (title, body) => test.step(title, body), `${Date.now()}`);
});
