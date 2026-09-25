import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // On CI: "list" names each test in the log, "github" annotates failures,
  // and "html" writes the playwright-report/ the workflow uploads (with only
  // "github" there was never anything to upload).
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // PocketID rate-limits one-time token redemption to a burst of 5, then one
  // per 10s, per IP. Signing in once per seed user here and reusing the saved
  // session keeps the suite under that however many specs need a user.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "e2e", dependencies: ["setup"] },
  ],
  webServer: {
    // The standalone server, as the Docker image runs it, not `next start`
    // (which warns it doesn't match `output: "standalone"`), so e2e catches
    // anything file tracing leaves out of the image.
    command: "npm run build && npm run start:standalone",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
