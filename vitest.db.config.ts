import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests against DATABASE_URL. Every test runs in a transaction that is
// rolled back, so they never change data. Run with: pnpm test:db
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI or shell-provided env
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.db.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
