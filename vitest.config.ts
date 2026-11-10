import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Database integration tests run separately: pnpm test:db
    exclude: ["src/**/*.db.test.ts", "node_modules/**"],
    environment: "node",
  },
});
