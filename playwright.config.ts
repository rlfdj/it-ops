import { defineConfig, devices } from "@playwright/test";

// Local env (Supabase keys, ALLOWED_EMAIL) for the sign-in helper.
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI or a deployed target: the variables come from the environment.
}

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // The write-path test creates real records; it only runs via playwright.writes.config.ts.
  testIgnore: ["**/workflows.spec.ts", "**/focus/**"],
  timeout: 60_000,
  retries: 0,
  // One magic-link token per user is valid at a time, so sign-ins must not overlap.
  workers: 1,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // Reuses a running `pnpm dev`; starts one when nothing is listening.
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "pnpm dev", url: baseURL, reuseExistingServer: true, timeout: 180_000 },
});
