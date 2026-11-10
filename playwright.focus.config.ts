import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Focused write tests, one file per area (e2e/focus/<area>.spec.ts). Each signs in, creates
// its own stamped data and cleans up, so a change can be checked in a minute or two:
//   BASE_URL=http://localhost:3000 pnpm test:e2e:focus board
// The full suite (pnpm test:e2e:writes) still runs once before merging.
export default defineConfig({
  ...base,
  testDir: "e2e/focus",
  testIgnore: [],
  testMatch: ["**/*.spec.ts"],
  timeout: 180_000,
  projects: base.projects?.filter((p) => p.name === "desktop"),
});
