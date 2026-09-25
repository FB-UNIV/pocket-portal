import { defineConfig } from "vitest/config";
import path from "node:path";

// Separate config for tests that hit a real PocketID + Postgres container
// (docker-compose.test.yml, brought up by `npm run test-env:up`). Not
// coverage-gated like the unit suite; these prove real wiring, not line coverage.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    testTimeout: 15_000,
    globalSetup: ["./vitest.integration.global-setup.ts"],
  },
});
