import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Write-path test: exercises every create/edit/tick/upload/delete flow through the UI.
// It writes real records (and append-only activity log entries) to whatever database the
// target uses. Run deliberately: pnpm test:e2e:writes
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ["**/workflows.spec.ts"],
  projects: base.projects?.filter((p) => p.name === "desktop"),
});
